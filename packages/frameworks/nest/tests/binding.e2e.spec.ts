import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import type { DefaultCrudService, OperationHandler } from "@crudo/core";
import { Crud, CrudoModule, enumProp, getCrudServiceToken, oneOfArray } from "@crudo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

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
      code: "CRUDO_NOT_DELETED",
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
    properties?: Record<string, { type: string }>;
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
    const schema = document.paths["/todos"]?.post?.requestBody?.content?.["application/json"]?.schema as
      Schema | undefined;

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
