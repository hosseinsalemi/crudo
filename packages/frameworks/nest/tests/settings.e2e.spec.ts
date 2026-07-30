import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { KavoModuleOptions } from "@kavo/nest";
import { Crud, KavoModule } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

/**
 * End-to-end coverage for `@Crud`/`KavoSettings` knobs that
 * `binding.e2e.spec.ts` never drives over HTTP (issue #47) — allowlists,
 * relation include budgets, filter limits, pagination `count`/limits, a
 * per-operation settings override, custom `meta.routes` on a
 * non-`@Override`'d standard operation, and `forRootAsync`. The no-arg
 * `KavoModule.forFeature()` path gets its own file (its registry is
 * process-wide, and this file — like `binding.e2e.spec.ts` — declares many
 * `@Crud(Todo, ...)` classes for the same entity).
 */

let app: INestApplication;
let adapter: InMemoryTodoAdapter;

interface BootstrapOptions {
  readonly defaults?: KavoModuleOptions["defaults"];
  readonly async?: boolean;
}

async function bootstrap(controller: unknown, options: BootstrapOptions = {}): Promise<void> {
  adapter = new InMemoryTodoAdapter();
  const infrastructure = fakeInfrastructure(adapter);
  const rootModule =
    options.async === true
      ? KavoModule.forRootAsync({ useFactory: () => ({ infrastructure, defaults: options.defaults }) })
      : KavoModule.forRoot({ infrastructure, defaults: options.defaults });
  const moduleRef = await Test.createTestingModule({
    imports: [rootModule, KavoModule.forFeature([controller as never])],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}

afterEach(async () => {
  await app.close();
});

function server(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

describe("@Crud allowlists — filterable/sortable/selectable enforced over HTTP", () => {
  @Crud(Todo, { allowlists: { filterable: ["done"], sortable: ["priority"], selectable: ["id", "title"] } })
  @Controller("todos")
  class AllowlistedController {}

  beforeEach(async () => {
    await bootstrap(AllowlistedController);
  });

  it("400s a filter field outside the allowlist", async () => {
    const response = await request(server()).get("/todos?filter[title][eq]=x").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "title", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("400s a sort field outside the allowlist", async () => {
    const response = await request(server()).get("/todos?sort=title").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "title", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("400s a select field outside the allowlist", async () => {
    const response = await request(server()).get("/todos?fields=priority").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "priority", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("allows a filter/sort/select field that is on the allowlist", async () => {
    await request(server()).get("/todos?filter[done][eq]=true&sort=priority&fields=id,title").expect(200);
  });
});

describe("@Crud relation include budgets (maxIncludeDepth/maxIncludedNodes)", () => {
  // `Todo.list` and `TodoList.list` deliberately share the relation name,
  // so one global `edges.list` entry opts both levels in at once (see
  // `fake-infrastructure.ts`) — an `include=list.list` request is a
  // genuine two-level tree, which a single relation can never produce
  // once a positive integer is the smallest legal budget.
  @Crud(Todo)
  @Controller("todos")
  class NestedIncludeController {}

  it("rejects an include deeper than the configured maxIncludeDepth", async () => {
    await bootstrap(NestedIncludeController, {
      defaults: { relations: { maxIncludeDepth: 1, edges: { list: { includable: true } } } },
    });

    const response = await request(server()).get("/todos?include=list.list").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "list.list", code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
    });
  });

  it("rejects an include tree exceeding the configured maxIncludedNodes", async () => {
    await bootstrap(NestedIncludeController, {
      defaults: { relations: { maxIncludedNodes: 1, edges: { list: { includable: true } } } },
    });

    const response = await request(server()).get("/todos?include=list.list").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "list.list", code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
    });
  });

  it("accepts an include within both budgets", async () => {
    @Crud(Todo, {
      relations: { maxIncludeDepth: 1, maxIncludedNodes: 1, edges: { list: { includable: true } } },
    })
    @Controller("todos")
    class RoomyController {}
    await bootstrap(RoomyController);

    await request(server()).get("/todos?include=list").expect(200);
  });
});

describe("@Crud query limits (maxFilterDepth/maxInValues) enforced over HTTP", () => {
  it("rejects a filter tree deeper than the configured maxFilterDepth", async () => {
    @Crud(Todo, { query: { maxFilterDepth: 1 } })
    @Controller("todos")
    class ShallowFilterController {}
    await bootstrap(ShallowFilterController);

    const response = await request(server()).get("/todos?filter[or][0][done][eq]=true").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "filter", code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
    });
  });

  it("rejects an `in` value list longer than the configured maxInValues", async () => {
    @Crud(Todo, { query: { maxInValues: 1 } })
    @Controller("todos")
    class NarrowInController {}
    await bootstrap(NarrowInController);

    const response = await request(server()).get("/todos?filter[title][in][]=a&filter[title][in][]=b").expect(400);
    expect(response.body).toMatchObject({
      code: "KAVO_QUERY_INVALID",
      errors: [{ field: "title", code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
    });
  });
});

describe("@Crud pagination — count and limit overrides over HTTP", () => {
  @Crud(Todo, { pagination: { count: false, defaultLimit: 1, maxLimit: 2 } })
  @Controller("todos")
  class NoCountController {}

  it("suppresses `total` in the envelope when pagination.count is false", async () => {
    await bootstrap(NoCountController);
    await request(server()).post("/todos").send({ title: "a" }).expect(201);
    await request(server()).post("/todos").send({ title: "b" }).expect(201);

    const response = await request(server()).get("/todos").expect(200);
    expect(response.body.total).toBeNull();
  });

  it("applies a custom defaultLimit with no limit param on the wire", async () => {
    await bootstrap(NoCountController);
    for (let i = 0; i < 3; i++) {
      await request(server())
        .post("/todos")
        .send({ title: `t${i}` })
        .expect(201);
    }
    const response = await request(server()).get("/todos").expect(200);
    expect(response.body.limit).toBe(1);
    expect(response.body.items).toHaveLength(1);
  });

  it("clamps a requested limit to a custom maxLimit", async () => {
    await bootstrap(NoCountController);
    const response = await request(server()).get("/todos?limit=50").expect(200);
    expect(response.body.limit).toBe(2);
  });
});

describe("@Crud per-operation settings override — scoped to that operation only", () => {
  @Crud(Todo, {
    pagination: { maxLimit: 100 },
    operations: { findMany: { pagination: { defaultLimit: 1, maxLimit: 1 } } },
  })
  @Controller("todos")
  class PerOperationController {}

  it("clamps findMany to the operation-level maxLimit rather than the entity default", async () => {
    await bootstrap(PerOperationController);
    const response = await request(server()).get("/todos?limit=50").expect(200);
    expect(response.body.limit).toBe(1);
  });
});

describe("@Crud custom meta.routes on a standard, non-@Override'd operation", () => {
  @Crud(Todo, {
    operations: { deleteOne: { meta: { routes: { path: ":id/remove", successStatus: 200 } } } },
  })
  @Controller("todos")
  class ReshapedDeleteController {}

  it("serves the reshaped route at the configured path and status", async () => {
    await bootstrap(ReshapedDeleteController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);

    await request(server()).delete("/todos/1/remove").expect(200);
  });

  it("no longer serves the default `DELETE /:id` route", async () => {
    await bootstrap(ReshapedDeleteController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);

    await request(server()).delete("/todos/1").expect(404);
  });
});

describe("KavoModule.forRootAsync — same route surface as forRoot", () => {
  @Crud(Todo)
  @Controller("todos")
  class AsyncController {}

  it("boots and serves the standard CRUD routes", async () => {
    await bootstrap(AsyncController, { async: true });

    const created = await request(server()).post("/todos").send({ title: "async" }).expect(201);
    expect(created.body).toMatchObject({ title: "async" });
    await request(server())
      .get(`/todos/${created.body.id as number}`)
      .expect(200);
  });

  it("still merges global defaults supplied through the async factory", async () => {
    await bootstrap(AsyncController, { async: true, defaults: { pagination: { defaultLimit: 1 } } });
    for (let i = 0; i < 2; i++) {
      await request(server())
        .post("/todos")
        .send({ title: `t${i}` })
        .expect(201);
    }
    const response = await request(server()).get("/todos").expect(200);
    expect(response.body.limit).toBe(1);
    expect(response.body.items).toHaveLength(1);
  });
});
