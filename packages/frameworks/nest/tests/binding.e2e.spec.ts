import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, Get, Inject, Param, type INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import type { DefaultKavoService, NormalizedQueryContext, OperationHandler } from "@kavo/core";
import { ConfigurationException, WireQuery } from "@kavo/core";
import type { KavoModuleOptions } from "@kavo/nest";
import { Kavo, KavoModule, Override, enumProp, flattenQuery, getKavoServiceToken, oneOfArray } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

let app: INestApplication;
let adapter: InMemoryTodoAdapter;

interface BootstrapOptions {
  readonly defaults?: KavoModuleOptions["defaults"];
  /**
   * Serve the app behind the qs-"extended" query parser (Express 4's
   * default) instead of Express 5's "simple" one — the nested-object shape
   * `flattenQuery` exists to normalize.
   */
  readonly extendedQueryParser?: boolean;
}

async function bootstrap(controller: unknown, options: BootstrapOptions = {}): Promise<void> {
  adapter = new InMemoryTodoAdapter();
  const moduleRef = await Test.createTestingModule({
    imports: [
      KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), defaults: options.defaults }),
      KavoModule.forFeature([controller as never]),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  if (options.extendedQueryParser === true) {
    (app.getHttpAdapter().getInstance() as { set(setting: string, value: string): void }).set(
      "query parser",
      "extended",
    );
  }
  await app.init();
}

afterEach(async () => {
  await app.close();
});

function server(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

describe("@Kavo route generation", () => {
  @Kavo(Todo)
  @Controller("todos")
  class TodoController {}

  beforeEach(async () => {
    await bootstrap(TodoController);
  });

  it("serves the six skeleton routes end to end", async () => {
    const created = await request(server()).post("/todos").send({ title: "write docs", priority: 2 }).expect(201);
    expect(created.body).toMatchObject({ id: 1, title: "write docs" });

    await request(server()).get("/todos/1").expect(200);

    const updated = await request(server())
      .put("/todos/1")
      .send({ title: "write more docs", done: false, priority: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({ title: "write more docs" });

    const patched = await request(server()).patch("/todos/1").send({ done: true }).expect(200);
    expect(patched.body).toMatchObject({ done: true });

    await request(server()).delete("/todos/1").expect(204);
    await request(server()).get("/todos/1").expect(404);
  });

  it("returns the ListResultDto envelope on the list route", async () => {
    for (let i = 1; i <= 5; i++) {
      await request(server())
        .post("/todos")
        .send({ title: `t${i}` })
        .expect(201);
    }
    const response = await request(server()).get("/todos?limit=2&offset=1").expect(200);
    expect(response.body).toMatchObject({
      limit: 2,
      offset: 1,
      total: 5,
      meta: {},
    });
    expect(response.body.items).toHaveLength(2);
  });

  it("rejects a repeated pagination param with a 400 rather than crashing", async () => {
    // `?limit=1&limit=2` reaches the binding as an array; it must survive
    // flattening intact so the normalizer can call it a bad value.
    const response = await request(server()).get("/todos?limit=1&limit=2").expect(400);
    expect(response.body).toMatchObject({ code: "KAVO_QUERY_INVALID" });
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ field: "limit", code: "KAVO_QUERY_INVALID_VALUE" }),
    );
  });

  it("parses the wire grammar into the filter AST (flat bracket keys)", async () => {
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server()).get("/todos?filter[done][eq]=true&filter[priority][gte]=2&sort=-priority").expect(200);
    const filter = adapter.lastQuery?.filter.root;
    expect(filter).toMatchObject({ kind: "group", operator: "AND" });
    expect(adapter.lastQuery?.sort).toEqual([{ field: "priority", direction: "desc" }]);
  });

  it("maps query validation to a 400 problem-details document", async () => {
    const response = await request(server())
      .get("/todos?filter[nope][eq]=1&sort=-nope")
      .expect(400)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({
      status: 400,
      code: "KAVO_QUERY_INVALID",
    });
    expect(response.body.errors).toHaveLength(2);
  });

  it("maps NotFound to a 404 problem-details document", async () => {
    const response = await request(server())
      .get("/todos/99")
      .expect(404)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({
      code: "KAVO_NOT_FOUND",
      type: "https://kavo.dev/errors/kavo-not-found",
    });
    expect(response.body.detail).toContain("99");
  });

  it("rejects a non-numeric id on a numeric id column with a 400", async () => {
    await request(server()).get("/todos/abc").expect(400);
  });

  it("strips generated/unknown keys from bodies", async () => {
    const created = await request(server()).post("/todos").send({ id: 999, title: "x", hacker: true }).expect(201);
    expect(created.body.id).toBe(1);
    expect(created.body).not.toHaveProperty("hacker");
  });

  it("exposes the typed service under getKavoServiceToken", async () => {
    const service = app.get<DefaultKavoService<Todo>>(getKavoServiceToken(Todo));
    const item = await service.createOne({ title: "via service" } as never);
    expect(item).toMatchObject({ title: "via service" });
  });

  it("generates no *Many/restore/purge routes while those are disabled", async () => {
    await request(server()).patch("/todos/1/restore").expect(404);
    await request(server()).delete("/todos/1/purge").expect(404);
  });
});

describe("@Kavo page pagination over the wire", () => {
  @Kavo(Todo, { pagination: { strategy: "page", defaultLimit: 2, maxLimit: 3 } })
  @Controller("todos")
  class PagedController {}

  beforeEach(async () => {
    await bootstrap(PagedController);
    for (let i = 1; i <= 7; i++) {
      await request(server())
        .post("/todos")
        .send({ title: `t${i}` })
        .expect(201);
    }
  });

  const titles = (body: { items: { title: string }[] }): string[] => body.items.map((item) => item.title);

  it("serves the requested 1-indexed page", async () => {
    const response = await request(server()).get("/todos?page[number]=2&page[size]=2").expect(200);
    expect(titles(response.body)).toEqual(["t3", "t4"]);
  });

  it("reports limit/offset in the envelope even under the page strategy", async () => {
    const response = await request(server()).get("/todos?page[number]=2&page[size]=2").expect(200);
    expect(response.body).toMatchObject({ limit: 2, offset: 2, total: 7 });
  });

  it("starts page 1 at offset 0 and falls back to defaultLimit", async () => {
    const response = await request(server()).get("/todos?page[number]=1").expect(200);
    expect(response.body).toMatchObject({ limit: 2, offset: 0 });
    expect(titles(response.body)).toEqual(["t1", "t2"]);
  });

  it("clamps page[size] to maxLimit before computing the offset", async () => {
    const response = await request(server()).get("/todos?page[number]=3&page[size]=99").expect(200);
    expect(response.body).toMatchObject({ limit: 3, offset: 6, total: 7 });
    expect(titles(response.body)).toEqual(["t7"]);
  });

  it("ignores limit/offset once the page strategy is in force", async () => {
    const response = await request(server()).get("/todos?limit=5&offset=5").expect(200);
    expect(response.body).toMatchObject({ limit: 2, offset: 0 });
  });

  it("maps a page number below 1 to a 400 problem-details document", async () => {
    const response = await request(server())
      .get("/todos?page[number]=0")
      .expect(400)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body.errors).toContainEqual(
      expect.objectContaining({ field: "page[number]", code: "KAVO_QUERY_INVALID_VALUE" }),
    );
  });
});

describe("@Kavo query-parser agnosticism", () => {
  @Kavo(Todo)
  @Controller("todos")
  class TodoController {}

  const wireQuery =
    "?filter[done][eq]=true&filter[priority][gte]=2&filter[title][in][]=a&filter[title][in][]=b" +
    "&filter[or][0][priority][eq]=5&filter[or][1][title][eq]=z&sort=-priority,title&limit=2&offset=1";

  async function normalizedQueryUnder(extendedQueryParser: boolean): Promise<NormalizedQueryContext<Todo> | null> {
    await bootstrap(TodoController, { extendedQueryParser });
    await request(server()).get(`/todos${wireQuery}`).expect(200);
    return adapter.lastQuery;
  }

  it("reaches the same normalized query whether the parser is simple or extended", async () => {
    const simple = await normalizedQueryUnder(false);
    await app.close();
    const extended = await normalizedQueryUnder(true);
    // The nested-object parse is the branch `flattenQuery` exists for
    // (doc 10 §2); equality of the normalized query is what "the binding is
    // parser-agnostic" means.
    expect(extended).toEqual(simple);
  });

  it("still builds the filter AST under the extended parser", async () => {
    const query = await normalizedQueryUnder(true);
    expect(query?.filter.root).toMatchObject({ kind: "group", operator: "AND" });
    expect(query?.sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "title", direction: "asc" },
    ]);
    expect(query?.pagination).toEqual({ limit: 2, offset: 1 });
  });
});

describe("@Kavo operation control surface", () => {
  it("generates no route for a disabled operation", async () => {
    @Kavo(Todo, { operations: { deleteOne: false } })
    @Controller("todos")
    class NoDeleteController {}

    await bootstrap(NoDeleteController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server()).delete("/todos/1").expect(404);
  });

  it("a global operations default guards the route rather than removing it (issue #38, ADR-0015)", async () => {
    // Decoration runs before KavoModule.forRoot(Async)'s options are known
    // (ADR-0012), so a global `defaults.operations.deleteOne: false` can't
    // retract the already-generated DELETE route. It reaches the bound
    // service instead: the route still exists, but calling it always
    // answers with a 405 problem-details document, never a 2xx or a bare 404.
    @Kavo(Todo)
    @Controller("todos")
    class GloballyGuardedController {}

    await bootstrap(GloballyGuardedController, { defaults: { operations: { deleteOne: false } } });
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    const response = await request(server())
      .delete("/todos/1")
      .expect(405)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({ code: "KAVO_OPERATION_DISABLED" });
  });

  it("an entity-level override still wins over a global operations default", async () => {
    @Kavo(Todo, { operations: { deleteOne: true } })
    @Controller("todos")
    class ReenabledController {}

    await bootstrap(ReenabledController, { defaults: { operations: { deleteOne: false } } });
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server()).delete("/todos/1").expect(204);
  });

  it("manual-method-wins: a hand-written method suppresses generation", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class ManualController {
      @Get(":id")
      findOne(): { manual: boolean } {
        return { manual: true };
      }
    }

    await bootstrap(ManualController);
    const response = await request(server()).get("/todos/1").expect(200);
    expect(response.body).toEqual({ manual: true });
    // Other routes still generate.
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
  });

  it("overrides all five singular standard operations, alongside manual-method-wins and a disabled operation (issue #21)", async () => {
    const seen: string[] = [];
    const overrideHandler = (id: string): OperationHandler<Todo> => ({
      async execute() {
        seen.push(id);
        return { id: 1, title: id, done: false, priority: 0, deletedAt: null, list: null };
      },
    });

    @Kavo(Todo, {
      operations: {
        createOne: { handler: overrideHandler("createOne") },
        updateOne: { handler: overrideHandler("updateOne") },
        patchOne: { handler: overrideHandler("patchOne") },
        deleteOne: {
          handler: {
            async execute() {
              seen.push("deleteOne");
              return null;
            },
          },
        },
        // Disabled alongside a full override set — a control surface that
        // otherwise touches every id must not confuse the disable path.
        findMany: false,
      },
    })
    @Controller("todos")
    class FullOverrideController {
      // Manual-method-wins over the findOne override too: the two
      // mechanisms are independent and must coexist without conflict.
      @Get(":id")
      findOne(): { manual: boolean } {
        return { manual: true };
      }
    }

    await bootstrap(FullOverrideController);

    const created = await request(server()).post("/todos").send({ title: "x" }).expect(201);
    expect(created.body).toMatchObject({ title: "createOne" });

    const found = await request(server()).get("/todos/1").expect(200);
    expect(found.body).toEqual({ manual: true });

    const updated = await request(server()).put("/todos/1").send({ title: "y" }).expect(200);
    expect(updated.body).toMatchObject({ title: "updateOne" });

    const patched = await request(server()).patch("/todos/1").send({ title: "z" }).expect(200);
    expect(patched.body).toMatchObject({ title: "patchOne" });

    await request(server()).delete("/todos/1").expect(204);

    // Disabled alongside five overrides: still no route.
    await request(server()).get("/todos").expect(404);

    expect(seen).toEqual(["createOne", "updateOne", "patchOne", "deleteOne"]);
  });
});

describe("@Kavo @Override — controller-method overrides that keep generated route metadata (issue #23)", () => {
  it("keeps findOne's generated route/param wiring, delegating to the decorated method", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class OverrideFindOneController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      @Override()
      async findOne(id: string, query: WireQuery): Promise<unknown> {
        const item = await this.base.findOne(id as never, query as never);
        return { ...item, viaOverride: true };
      }
    }

    await bootstrap(OverrideFindOneController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    const response = await request(server()).get("/todos/1").expect(200);
    expect(response.body).toMatchObject({ id: 1, title: "x", viaOverride: true });

    // Regression: a wire-format query string must reach the override
    // normalized, not passed through raw — this is what auto-wiring buys
    // (issue #25). The override never calls flattenQuery/WireQuery itself.
    const narrowed = await request(server()).get("/todos/1").query("fields=id,title").expect(200);
    expect(Object.keys(narrowed.body).sort()).toEqual(["id", "title", "viaOverride"]);
  });

  it("passes an overridden findOne a WireQuery instance, not a raw query object (issue #25)", async () => {
    let received: unknown;

    @Kavo(Todo)
    @Controller("todos")
    class OverrideFindOneQueryShapeController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      @Override()
      async findOne(id: string, query: WireQuery): Promise<unknown> {
        received = query;
        return this.base.findOne(id as never, query as never);
      }
    }

    await bootstrap(OverrideFindOneQueryShapeController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server()).get("/todos/1").query("fields=id,title").expect(200);

    expect(received).toBeInstanceOf(WireQuery);
    expect((received as WireQuery).params).toMatchObject({ fields: "id,title" });
  });

  it("passes an overridden findMany a WireQuery instance, not a raw query object (issue #25)", async () => {
    let received: unknown;

    @Kavo(Todo)
    @Controller("todos")
    class OverrideFindManyQueryShapeController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      @Override()
      async findMany(query: WireQuery): Promise<unknown> {
        received = query;
        return this.base.findMany(query as never);
      }
    }

    await bootstrap(OverrideFindManyQueryShapeController);
    await request(server()).get("/todos").query("limit=2&offset=1").expect(200);

    expect(received).toBeInstanceOf(WireQuery);
    expect((received as WireQuery).params).toMatchObject({ limit: "2", offset: "1" });
  });

  it("keeps filtering intact when a stale override still manually double-wraps its already-wired query (issue #25 regression)", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class StaleDoubleWrapController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      // Pre-#25 pattern: `query` is already a WireQuery (via WireQueryPipe),
      // but this override still calls flattenQuery/WireQuery on it itself.
      // Without flattenQuery's idempotency guard, this would silently mangle
      // every key one bracket level too deep and drop the filter entirely.
      @Override()
      async findMany(query: WireQuery): Promise<unknown> {
        const rewrapped = new WireQuery(flattenQuery(query as unknown as Record<string, unknown>));
        return this.base.findMany(rewrapped as never);
      }
    }

    await bootstrap(StaleDoubleWrapController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);

    // The fake adapter doesn't evaluate filters — it only records the
    // normalized query (filter evaluation is @kavo/typeorm's concern) — so
    // assert on the normalized AST itself: without flattenQuery's idempotency
    // guard, the mangled `params[filter[...]]` keys would vanish, leaving an
    // empty filter/sort with no error raised, rather than the AST below.
    await request(server()).get("/todos?filter[title][eq]=x&sort=-priority").expect(200);
    expect(adapter.lastQuery?.filter.root).toMatchObject({ kind: "condition", field: "title", operator: "EQ" });
    expect(adapter.lastQuery?.sort).toEqual([{ field: "priority", direction: "desc" }]);
  });

  it("keeps createOne's generated route/param wiring (body alone, 201, no :id)", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class OverrideCreateOneController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      @Override()
      async createOne(body: { title: string }): Promise<unknown> {
        return this.base.createOne({ ...body, title: body.title.toUpperCase() } as never);
      }
    }

    await bootstrap(OverrideCreateOneController);
    const response = await request(server()).post("/todos").send({ title: "loud" }).expect(201);
    expect(response.body).toMatchObject({ title: "LOUD" });
  });

  it("wires an explicit operationId to a differently-named method (id+body write), not just name-matched ones", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class ExplicitIdOverrideController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      // The method name is unrelated to "updateOne" — proves resolution
      // uses the override map's target, not descriptor.id, end to end.
      @Override("updateOne")
      async customUpdate(id: string, body: { title: string }): Promise<unknown> {
        return this.base.updateOne(id as never, { ...body, title: body.title.toUpperCase() } as never);
      }
    }

    await bootstrap(ExplicitIdOverrideController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    const response = await request(server()).put("/todos/1").send({ title: "loud" }).expect(200);
    expect(response.body).toMatchObject({ id: 1, title: "LOUD" });
  });

  it("keeps an overridden operation's own custom meta.routes shape (id-bearing route)", async () => {
    @Kavo(Todo, {
      operations: {
        updateOne: { meta: { routes: { method: "POST", path: ":id/activate" } } },
      },
    })
    @Controller("todos")
    class OverrideCustomRouteController {
      @Override("updateOne")
      async activate(id: string): Promise<unknown> {
        const row = adapter.rows.find((candidate) => candidate.id === Number(id));
        if (row !== undefined) row.done = true;
        return row ?? null;
      }
    }

    await bootstrap(OverrideCustomRouteController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    const response = await request(server()).post("/todos/1/activate").expect(200);
    expect(response.body).toMatchObject({ id: 1, done: true });
  });

  it("documents an overridden route with the same Swagger shape a generated one would carry", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class OverrideSwaggerController {
      constructor(@Inject(getKavoServiceToken(Todo)) private readonly base: DefaultKavoService<Todo>) {}

      @Override()
      async findOne(id: string, query: WireQuery): Promise<unknown> {
        return this.base.findOne(id as never, query as never);
      }
    }

    await bootstrap(OverrideSwaggerController);
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("t").setVersion("0").build());
    const getItem = (
      document.paths["/todos/{id}"] as Record<
        string,
        { operationId?: string; parameters?: { name: string; in: string }[]; responses?: Record<string, unknown> }
      >
    )?.get;
    expect(getItem?.operationId).toBe("Todo_findOne");
    expect(getItem?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "id", in: "path" })]));
    expect(getItem?.responses).toHaveProperty("200");
    expect(getItem?.responses).toHaveProperty("404");
  });

  it("leaves plain manual-method-wins (no @Override) exactly as before", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class ManualStillWinsController {
      @Get(":id")
      findOne(): { manual: boolean } {
        return { manual: true };
      }
    }

    await bootstrap(ManualStillWinsController);
    const response = await request(server()).get("/todos/1").expect(200);
    expect(response.body).toEqual({ manual: true });
  });

  it("throws at decoration time when two methods override the same operation", () => {
    let error: unknown;
    try {
      @Kavo(Todo)
      @Controller("todos")
      class DuplicateOverrideController {
        @Override("createOne")
        first(): void {}
        @Override("createOne")
        second(): void {}
      }
      void DuplicateOverrideController;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationException);
    expect(error).toMatchObject({ code: "KAVO_CONFIG_INVALID", messageParams: { path: "override.createOne" } });
  });

  it("throws at decoration time when @Override names an operation that is off by default", () => {
    let error: unknown;
    try {
      @Kavo(Todo)
      @Controller("todos")
      class DisabledOverrideController {
        @Override("purgeOne")
        purge(): void {}
      }
      void DisabledOverrideController;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationException);
    expect(error).toMatchObject({ code: "KAVO_CONFIG_INVALID", messageParams: { path: "override.purgeOne" } });
  });

  it("throws at decoration time when @Override names an operation id absent from the registry", () => {
    let error: unknown;
    try {
      @Kavo(Todo)
      @Controller("todos")
      class GhostOverrideController {
        @Override("ghost")
        ghost(): void {}
      }
      void GhostOverrideController;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationException);
    expect(error).toMatchObject({ code: "KAVO_CONFIG_INVALID", messageParams: { path: "override.ghost" } });
  });

  it("throws at decoration time when @Override targets a service-only operation", () => {
    let error: unknown;
    try {
      @Kavo(Todo, {
        operations: {
          deleteOne: { meta: { routes: { enabled: false } } },
        },
      })
      @Controller("todos")
      class ServiceOnlyOverrideController {
        @Override("deleteOne")
        recalc(): void {}
      }
      void ServiceOnlyOverrideController;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationException);
    expect(error).toMatchObject({ code: "KAVO_CONFIG_INVALID", messageParams: { path: "override.deleteOne" } });
  });

  it("throws at decoration time when the overridden method declares its own @Param/@Body", () => {
    let error: unknown;
    try {
      @Kavo(Todo)
      @Controller("todos")
      class SelfParamOverrideController {
        @Override()
        findOne(@Param("id") id: string): unknown {
          return { id };
        }
      }
      void SelfParamOverrideController;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationException);
    expect(error).toMatchObject({ code: "KAVO_CONFIG_INVALID", messageParams: { path: "override.findOne" } });
  });
});

describe("KavoExceptionFilter — non-Kavo handler failures", () => {
  const exploding: OperationHandler<Todo> = {
    async execute() {
      throw new Error("connection to shard-7 refused");
    },
  };

  @Kavo(Todo, { operations: { createOne: { handler: exploding } } })
  @Controller("todos")
  class ExplodingController {}

  it("answers with a problem-details document at the catalog status", async () => {
    await bootstrap(ExplodingController);
    const response = await request(server())
      .post("/todos")
      .send({ title: "x" })
      .expect(500)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({
      type: "https://kavo.dev/errors/kavo-persistence-failed",
      title: "Persistence failure",
      status: 500,
      code: "KAVO_PERSISTENCE_FAILED",
    });
  });

  it("keeps the driver detail out of the body while exposeInternals is off", async () => {
    await bootstrap(ExplodingController);
    const response = await request(server()).post("/todos").send({ title: "x" }).expect(500);
    expect(JSON.stringify(response.body)).not.toContain("shard-7");
  });

  it("leaks the cause only when exposeInternals is turned on", async () => {
    await bootstrap(ExplodingController, { defaults: { errors: { exposeInternals: true } } });
    const response = await request(server()).post("/todos").send({ title: "x" }).expect(500);
    expect(response.body.detail).toContain("shard-7");
  });

  it("reports the occurrence as a correlation URN", async () => {
    await bootstrap(ExplodingController);
    const response = await request(server()).post("/todos").send({ title: "x" }).expect(500);
    expect(response.body.instance).toMatch(/^urn:kavo:request:/);
  });
});

describe("@Kavo soft-delete routes", () => {
  @Kavo(Todo, {
    softDelete: { strategy: "soft" },
    operations: { purgeOne: true },
  })
  @Controller("todos")
  class SoftDeleteController {}

  beforeEach(async () => {
    await bootstrap(SoftDeleteController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
  });

  it("soft-deletes on DELETE and hides the row from reads", async () => {
    await request(server()).delete("/todos/1").expect(204);
    expect(adapter.rows[0]?.deletedAt).toBeInstanceOf(Date);
    await request(server()).get("/todos/1").expect(404);
    expect((await request(server()).get("/todos").expect(200)).body.total).toBe(0);
  });

  it("returns deleted rows for withDeleted=true", async () => {
    await request(server()).delete("/todos/1").expect(204);
    const response = await request(server()).get("/todos?withDeleted=true").expect(200);
    expect(response.body.items).toHaveLength(1);
  });

  it("restores through PATCH /:id/restore, returning the item", async () => {
    await request(server()).delete("/todos/1").expect(204);
    const restored = await request(server()).patch("/todos/1/restore").expect(200);
    expect(restored.body).toMatchObject({ id: 1, title: "x" });
    await request(server()).get("/todos/1").expect(200);
  });

  it("maps a restore of a live row to a 409 problem details", async () => {
    const response = await request(server()).patch("/todos/1/restore").expect(409);
    expect(response.body).toMatchObject({
      status: 409,
      code: "KAVO_NOT_DELETED",
    });
  });

  it("purges through DELETE /:id/purge, but only what is already deleted", async () => {
    await request(server()).delete("/todos/1/purge").expect(409);
    await request(server()).delete("/todos/1").expect(204);
    await request(server()).delete("/todos/1/purge").expect(204);
    expect(adapter.rows).toHaveLength(0);
  });

  it("keeps purge unrouted unless it is asked for by name", async () => {
    @Kavo(Todo, { softDelete: { strategy: "soft" } })
    @Controller("todos")
    class RestoreOnlyController {}

    await app.close();
    await bootstrap(RestoreOnlyController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server()).delete("/todos/1").expect(204);
    await request(server()).patch("/todos/1/restore").expect(200);
    await request(server()).delete("/todos/1/purge").expect(404);
  });
});

describe("@Kavo relation includes", () => {
  @Kavo(Todo, { relations: { edges: { list: { includable: true } } } })
  @Controller("todos")
  class IncludingController {}

  beforeEach(async () => {
    await bootstrap(IncludingController);
  });

  it("parses include= off the wire and embeds the loaded relation", async () => {
    await request(server()).post("/todos").send({ title: "x", list: 7 }).expect(201);
    // The fake adapter stores what deserialization produced: an `{ id }`
    // association, which is what a real adapter would resolve.
    expect(adapter.rows[0]?.list).toEqual({ id: 7 });

    const response = await request(server()).get("/todos?include=list").expect(200);
    expect(response.body.items[0]).toMatchObject({ title: "x", list: { id: 7 } });
  });

  it("narrows an included node with fields[relation]", async () => {
    await request(server()).post("/todos").send({ title: "x", list: 7 }).expect(201);
    const response = await request(server()).get("/todos/1?include=list&fields[list]=id").expect(200);
    expect(response.body.list).toEqual({ id: 7 });
  });

  it("rejects a relation that is not includable, with problem details", async () => {
    @Kavo(Todo)
    @Controller("todos")
    class ClosedController {}

    // Replace the including app with one that opted nothing in.
    await app.close();
    await bootstrap(ClosedController);
    const response = await request(server()).get("/todos?include=list").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "list", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("documents include and fields[relation] in the OpenAPI schema", async () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const params = (document.paths["/todos"]?.get?.parameters ?? []) as { name: string; description?: string }[];
    const include = params.find((param) => param.name === "include");
    expect(include?.description).toContain("Includable: list");
    expect(params.map((param) => param.name)).toContain("fields[list]");
  });
});

describe("@Kavo Swagger request-body schemas", () => {
  class CreateTodoDto {
    title = "";
    priority = 0;
    done = false;
  }

  class TodoItemDto {
    id = 0;
    title = "";
    done = false;
  }

  class TodoListDto {
    id = 0;
    title = "";
  }

  @Kavo(Todo, {
    dto: { create: CreateTodoDto, item: TodoItemDto, list: TodoListDto },
  })
  @Controller("todos")
  class DocumentedController {}

  let document: ReturnType<typeof SwaggerModule.createDocument>;

  beforeEach(async () => {
    await bootstrap(DocumentedController);
    document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("t").setVersion("0").build());
  });

  type Schema = {
    type?: string;
    properties?: Record<string, Schema>;
    items?: Schema;
  };

  const responseSchema = (op: string, status: string): Schema | undefined =>
    (
      document.paths["/todos"] as Record<
        string,
        { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
      >
    )?.[op]?.responses?.[status]?.content?.["application/json"]?.schema;

  const itemSchema = (op: string, path: string, status: string): Schema | undefined =>
    (
      document.paths[path] as Record<
        string,
        { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
      >
    )?.[op]?.responses?.[status]?.content?.["application/json"]?.schema;

  it("documents the create body with the DTO's runtime shape", async () => {
    const schema = (
      document.paths["/todos"] as Record<string, { requestBody?: { content?: Record<string, { schema?: Schema }> } }>
    )?.["post"]?.requestBody?.content?.["application/json"]?.schema;

    // The body renders with real fields (not an empty {}): the bug was an
    // empty schema because @nestjs/swagger can't read runtime initializers.
    expect(schema?.properties).toBeDefined();
    expect(Object.keys(schema?.properties ?? {})).toEqual(["title", "priority", "done"]);
    expect(schema?.properties?.title).toEqual({ type: "string" });
    expect(schema?.properties?.priority).toEqual({ type: "integer" });
    expect(schema?.properties?.done).toEqual({ type: "boolean" });
  });

  it("documents create/put/patch/get-item responses with the item DTO", () => {
    for (const [op, path, status] of [
      ["post", "/todos", "201"],
      ["put", "/todos/{id}", "200"],
      ["patch", "/todos/{id}", "200"],
      ["get", "/todos/{id}", "200"],
    ] as const) {
      const schema = itemSchema(op, path, status);
      expect(Object.keys(schema?.properties ?? {})).toEqual(["id", "title", "done"]);
    }
  });

  it("documents the collection response with the list envelope", () => {
    const schema = responseSchema("get", "200");
    expect(Object.keys(schema?.properties ?? {})).toEqual(["items", "limit", "offset", "total", "meta"]);
    // Envelope items use the leaner `list` DTO projection.
    expect(Object.keys(schema?.properties?.items?.items?.properties ?? {})).toEqual(["id", "title"]);
  });
});

describe("@Kavo Swagger DTO slot fallbacks", () => {
  class UpdateTodoDto {
    title = "";
    done = false;
  }

  class TodoOnlyItemDto {
    id = 0;
    title = "";
  }

  // `patch` and `list` are deliberately left unregistered. The core
  // resolver falls `patch` back to `update` and `list` back to `item`, and
  // the docs must follow the same chain the engine will actually use —
  // otherwise the published schema advertises a shape the API never emits.
  @Kavo(Todo, { dto: { update: UpdateTodoDto, item: TodoOnlyItemDto } })
  @Controller("todos")
  class FallbackController {}

  let document: ReturnType<typeof SwaggerModule.createDocument>;

  beforeEach(async () => {
    await bootstrap(FallbackController);
    document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("t").setVersion("0").build());
  });

  type Schema = {
    type?: string;
    properties?: Record<string, Schema>;
    items?: Schema;
  };

  it("documents the patch body from the update DTO when no patch DTO is registered", () => {
    const schema = (
      document.paths["/todos/{id}"] as Record<
        string,
        { requestBody?: { content?: Record<string, { schema?: Schema }> } }
      >
    )?.["patch"]?.requestBody?.content?.["application/json"]?.schema;
    expect(Object.keys(schema?.properties ?? {})).toEqual(["title", "done"]);
  });

  it("documents the list envelope from the item DTO when no list DTO is registered", () => {
    const schema = (
      document.paths["/todos"] as Record<
        string,
        { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
      >
    )?.["get"]?.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(Object.keys(schema?.properties?.items?.items?.properties ?? {})).toEqual(["id", "title"]);
  });
});

describe("@Kavo Swagger schema hints (enum, oneOf)", () => {
  class VariantA {
    id = 0;
    a = "";
  }
  class VariantB {
    id = 0;
    b = 0;
  }

  class CreateHintedDto {
    title = "";
    size = enumProp(["small", "medium", "large"], { example: "medium" });
  }
  class HintedItemDto {
    id = 0;
    size = enumProp(["small", "medium", "large"]);
    children = oneOfArray<VariantA | VariantB>([VariantA, VariantB]);
  }

  @Kavo(Todo, { dto: { create: CreateHintedDto, item: HintedItemDto } })
  @Controller("todos")
  class HintedController {}

  type HintSchema = {
    type?: string;
    properties?: Record<string, HintSchema>;
    items?: HintSchema;
    enum?: readonly (string | number)[];
    example?: string | number;
    oneOf?: readonly HintSchema[];
    title?: string;
  };

  let document: ReturnType<typeof SwaggerModule.createDocument>;
  beforeEach(async () => {
    await bootstrap(HintedController);
    document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("t").setVersion("0").build());
  });

  const bodySchema = (): HintSchema | undefined =>
    (document.paths["/todos"] as { post?: { requestBody?: { content?: Record<string, { schema?: HintSchema }> } } })
      ?.post?.requestBody?.content?.["application/json"]?.schema;

  const itemSchema = (): HintSchema | undefined =>
    (
      document.paths["/todos/{id}"] as Record<
        string,
        { responses?: Record<string, { content?: Record<string, { schema?: HintSchema }> }> }
      >
    )?.get?.responses?.["200"]?.content?.["application/json"]?.schema;

  it("documents an enum field with its allowed values", () => {
    expect(bodySchema()?.properties?.size).toEqual({
      type: "string",
      enum: ["small", "medium", "large"],
      example: "medium",
    });
  });

  it("documents an enum field without an example when none is given", () => {
    expect(itemSchema()?.properties?.size).toEqual({ type: "string", enum: ["small", "medium", "large"] });
  });

  it("documents a oneOf array field with per-variant schemas", () => {
    const children = itemSchema()?.properties?.children;
    expect(children?.type).toBe("array");
    expect(children?.items?.oneOf).toEqual([
      { title: "VariantA", type: "object", properties: { id: { type: "integer" }, a: { type: "string" } } },
      { title: "VariantB", type: "object", properties: { id: { type: "integer" }, b: { type: "integer" } } },
    ]);
  });
});
