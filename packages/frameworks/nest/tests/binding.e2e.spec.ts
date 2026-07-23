import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DefaultCrudService, OperationHandler } from "@crudo/core";
import { Crud, CrudoModule, getCrudServiceToken } from "@crudo/nest";
import {
  InMemoryTodoAdapter,
  Todo,
  fakeInfrastructure,
} from "./support/fake-infrastructure.js";

let app: INestApplication;
let adapter: InMemoryTodoAdapter;

async function bootstrap(controller: unknown): Promise<void> {
  adapter = new InMemoryTodoAdapter();
  const moduleRef = await Test.createTestingModule({
    imports: [
      CrudoModule.forRoot({ infrastructure: fakeInfrastructure(adapter) }),
      CrudoModule.forFeature([controller as never]),
    ],
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

describe("@Crud route generation (Phases 11–12)", () => {
  @Crud(Todo)
  @Controller("todos")
  class TodoController {}

  beforeEach(async () => {
    await bootstrap(TodoController);
  });

  it("serves the six skeleton routes end to end", async () => {
    const created = await request(server())
      .post("/todos")
      .send({ title: "write docs", priority: 2 })
      .expect(201);
    expect(created.body).toMatchObject({ id: 1, title: "write docs" });

    await request(server()).get("/todos/1").expect(200);

    const updated = await request(server())
      .put("/todos/1")
      .send({ title: "write more docs", done: false, priority: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({ title: "write more docs" });

    const patched = await request(server())
      .patch("/todos/1")
      .send({ done: true })
      .expect(200);
    expect(patched.body).toMatchObject({ done: true });

    await request(server()).delete("/todos/1").expect(204);
    await request(server()).get("/todos/1").expect(404);
  });

  it("returns the ListResultDto envelope on the list route", async () => {
    for (let i = 1; i <= 5; i++) {
      await request(server()).post("/todos").send({ title: `t${i}` }).expect(201);
    }
    const response = await request(server())
      .get("/todos?limit=2&offset=1")
      .expect(200);
    expect(response.body).toMatchObject({
      limit: 2,
      offset: 1,
      total: 5,
      meta: {},
    });
    expect(response.body.items).toHaveLength(2);
  });

  it("parses the wire grammar into the filter AST (flat bracket keys)", async () => {
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    await request(server())
      .get("/todos?filter[done][eq]=true&filter[priority][gte]=2&sort=-priority")
      .expect(200);
    const filter = adapter.lastQuery?.filter.root;
    expect(filter).toMatchObject({ kind: "group", operator: "AND" });
    expect(adapter.lastQuery?.sort).toEqual([
      { field: "priority", direction: "desc" },
    ]);
  });

  it("maps query validation to a 400 problem-details document", async () => {
    const response = await request(server())
      .get("/todos?filter[nope][eq]=1&sort=-nope")
      .expect(400)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({
      status: 400,
      code: "CRUDO_QUERY_INVALID",
    });
    expect(response.body.errors).toHaveLength(2);
  });

  it("maps NotFound to a 404 problem-details document", async () => {
    const response = await request(server())
      .get("/todos/99")
      .expect(404)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({
      code: "CRUDO_NOT_FOUND",
      type: "https://crudo.dev/errors/crudo-not-found",
    });
    expect(response.body.detail).toContain("99");
  });

  it("rejects a non-numeric id on a numeric id column with a 400", async () => {
    await request(server()).get("/todos/abc").expect(400);
  });

  it("strips generated/unknown keys from bodies", async () => {
    const created = await request(server())
      .post("/todos")
      .send({ id: 999, title: "x", hacker: true })
      .expect(201);
    expect(created.body.id).toBe(1);
    expect(created.body).not.toHaveProperty("hacker");
  });

  it("exposes the typed service under getCrudServiceToken", async () => {
    const service = app.get<DefaultCrudService<Todo>>(
      getCrudServiceToken(Todo),
    );
    const item = await service.createOne({ title: "via service" } as never);
    expect(item).toMatchObject({ title: "via service" });
  });

  it("generates no *Many/restore/purge routes while those are disabled", async () => {
    await request(server()).patch("/todos/1/restore").expect(404);
    await request(server()).delete("/todos/1/purge").expect(404);
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
          handler: { async execute() { return null; } },
          meta: { routes: { enabled: false } }, // service-only
        },
      },
    })
    @Controller("todos")
    class CustomController {}

    await bootstrap(CustomController);
    await request(server()).post("/todos").send({ title: "x" }).expect(201);
    const response = await request(server())
      .post("/todos/1/activate")
      .expect(201);
    expect(response.body).toMatchObject({ id: 1, done: true });
    // Service-only: no route.
    await request(server()).post("/todos/recalculate").expect(404);
  });
});
