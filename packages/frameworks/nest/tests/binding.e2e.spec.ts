import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import type { DefaultCrudService, NormalizedQueryContext, OperationHandler } from "@kavo/core";
import type { KavoModuleOptions } from "@kavo/nest";
import { Crud, KavoModule, enumProp, getCrudServiceToken, oneOfArray } from "@kavo/nest";
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

describe("@Crud route generation (Phases 11–12)", () => {
  @Crud(Todo)
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

  it("exposes the typed service under getCrudServiceToken", async () => {
    const service = app.get<DefaultCrudService<Todo>>(getCrudServiceToken(Todo));
    const item = await service.createOne({ title: "via service" } as never);
    expect(item).toMatchObject({ title: "via service" });
  });

  it("generates no *Many/restore/purge routes while those are disabled", async () => {
    await request(server()).patch("/todos/1/restore").expect(404);
    await request(server()).delete("/todos/1/purge").expect(404);
  });
});

describe("@Crud page pagination over the wire (Phase 5)", () => {
  @Crud(Todo, { pagination: { strategy: "page", defaultLimit: 2, maxLimit: 3 } })
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

describe("@Crud query-parser agnosticism (Phases 11–12)", () => {
  @Crud(Todo)
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

describe("@Crud operation control surface", () => {
  it("generates no route for a disabled operation", async () => {
    @Crud(Todo, { operations: { deleteOne: false } })
    @Controller("todos")
    class NoDeleteController {}

    await bootstrap(NoDeleteController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server()).delete("/todos/1").expect(404);
  });

  it("manual-method-wins: a hand-written method suppresses generation", async () => {
    @Crud(Todo)
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

  it("generates routes for custom operations from meta.routes", async () => {
    const activate: OperationHandler<Todo> = {
      async execute(_input, context) {
        const service = context.state; // unused; handler works via adapter rows
        void service;
        const row = adapter.rows.find((r) => r.id === 1);
        if (row !== undefined) row.done = true;
        return row ?? null;
      },
    };

    @Crud(Todo, {
      customOperations: {
        activate: {
          handler: activate,
          meta: { routes: { method: "POST", path: ":id/activate" } },
        },
        recalculate: {
          handler: {
            async execute() {
              return null;
            },
          },
          meta: { routes: { enabled: false } }, // service-only
        },
      },
    })
    @Controller("todos")
    class CustomController {}

    await bootstrap(CustomController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    const response = await request(server()).post("/todos/1/activate").expect(201);
    expect(response.body).toMatchObject({ id: 1, done: true });
    // Service-only: no route.
    await request(server()).post("/todos/recalculate").expect(404);
  });
});

describe("KavoExceptionFilter — non-Kavo handler failures (Phase 6)", () => {
  const exploding: OperationHandler<Todo> = {
    async execute() {
      throw new Error("connection to shard-7 refused");
    },
  };

  @Crud(Todo, {
    customOperations: {
      explode: { handler: exploding, meta: { routes: { method: "POST", path: "explode" } } },
    },
  })
  @Controller("todos")
  class ExplodingController {}

  it("answers with a problem-details document at the catalog status", async () => {
    await bootstrap(ExplodingController);
    const response = await request(server())
      .post("/todos/explode")
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
    const response = await request(server()).post("/todos/explode").expect(500);
    expect(JSON.stringify(response.body)).not.toContain("shard-7");
  });

  it("leaks the cause only when exposeInternals is turned on", async () => {
    await bootstrap(ExplodingController, { defaults: { errors: { exposeInternals: true } } });
    const response = await request(server()).post("/todos/explode").expect(500);
    expect(response.body.detail).toContain("shard-7");
  });

  it("reports the occurrence as a correlation URN", async () => {
    await bootstrap(ExplodingController);
    const response = await request(server()).post("/todos/explode").expect(500);
    expect(response.body.instance).toMatch(/^urn:kavo:request:/);
  });
});

describe("@Crud soft-delete routes (Phase 14)", () => {
  @Crud(Todo, {
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
    @Crud(Todo, { softDelete: { strategy: "soft" } })
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

describe("@Crud relation includes (Phase 15)", () => {
  @Crud(Todo, { relations: { edges: { list: { includable: true } } } })
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
    @Crud(Todo)
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

describe("@Crud Swagger request-body schemas", () => {
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

  @Crud(Todo, {
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

describe("@Crud Swagger DTO slot fallbacks", () => {
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
  @Crud(Todo, { dto: { update: UpdateTodoDto, item: TodoOnlyItemDto } })
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

describe("@Crud Swagger schema hints (enum, oneOf)", () => {
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

  @Crud(Todo, { dto: { create: CreateHintedDto, item: HintedItemDto } })
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
