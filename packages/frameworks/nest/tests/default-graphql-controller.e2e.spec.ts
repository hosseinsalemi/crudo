import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Crud, KavoModule } from "@kavo/nest";
import { registerCrudGraphQLTypes } from "@kavo/graphql";
import {
  GraphQLBoolean,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

/**
 * Proves the zero-controller path: `KavoModule.forRoot({ graphql: true })`
 * mounts `POST /graphql` on its own — no `GraphQLController` anywhere in
 * this file, unlike `base-crud-graphql.controller.e2e.spec.ts`, which
 * covers the opt-out (a hand-written controller extending
 * `BaseCrudGraphQLController`). Vitest isolates modules per file, so a
 * single `@Crud(Todo)` registration here is safe, same reasoning as the
 * other GraphQL e2e specs.
 */
const TodoType = new GraphQLObjectType({
  name: "Todo",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLInt) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    done: { type: new GraphQLNonNull(GraphQLBoolean) },
  },
});
const CreateTodoInput = new GraphQLInputObjectType({
  name: "CreateTodoInput",
  fields: {
    title: { type: new GraphQLNonNull(GraphQLString) },
    done: { type: GraphQLBoolean },
  },
});
registerCrudGraphQLTypes(Todo, { itemType: TodoType, createInputType: CreateTodoInput });

@Crud(Todo)
@Controller("todos")
class TodoController {}

let app: INestApplication;

afterEach(async () => {
  await app.close();
});

describe("KavoModule.forRoot({ graphql: true })", () => {
  it("mounts POST /graphql with no controller of its own", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), graphql: true })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/graphql")
      .send({ query: `mutation { createTodo(input: { title: "zero controller", done: false }) { id title } }` })
      .expect(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTodo).toEqual({ id: 1, title: "zero controller" });

    const fetched = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/graphql")
      .send({ query: `query { todo(id: 1) { title } }` })
      .expect(200);
    expect(fetched.body.errors).toBeUndefined();
    expect(fetched.body.data.todo).toEqual({ title: "zero controller" });
  });

  it("mounts at a custom path when { path } is given instead of true", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), graphql: { path: "api/graphql" } })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/graphql")
      .expect(404);

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/graphql")
      .send({ query: `mutation { createTodo(input: { title: "custom path", done: false }) { id title } }` })
      .expect(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTodo).toEqual({ id: 1, title: "custom path" });
  });

  it("mounts no controller at all when graphql is left unset", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter) })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/graphql")
      .expect(404);
  });
});
