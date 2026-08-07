import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Kavo, KavoModule } from "@kavo/nest";
import { registerKavoGraphQLTypes } from "@kavo/graphql";
import {
  GraphQLBoolean,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";
import { listen } from "./support/listen.js";

/**
 * Proves the zero-controller path: `KavoModule.forRoot({ graphql: true })`
 * mounts `POST /graphql` on its own — no `GraphQLController` anywhere in
 * this file, unlike `base-kavo-graphql.controller.e2e.spec.ts`, which
 * covers the opt-out (a hand-written controller extending
 * `BaseKavoGraphQLController`). Vitest isolates modules per file, so a
 * single `@Kavo(Todo)` registration here is safe, same reasoning as the
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
registerKavoGraphQLTypes(Todo, { itemType: TodoType, createInputType: CreateTodoInput });

@Kavo(Todo)
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
    const server = await listen(app);

    const created = await request(server)
      .post("/graphql")
      .send({ query: `mutation { createTodo(input: { title: "zero controller", done: false }) { id title } }` })
      .expect(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTodo).toEqual({ id: 1, title: "zero controller" });

    const fetched = await request(server)
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
    const server = await listen(app);

    await request(server).post("/graphql").expect(404);

    const created = await request(server)
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
    const server = await listen(app);

    await request(server).post("/graphql").expect(404);
  });

  it("falls back to the default path when given an options object that omits one", async () => {
    // `graphql: {}` is what an app writes when it builds the option object
    // programmatically with no path to contribute; it must mean the same
    // thing as `graphql: true`, not "mount at undefined".
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), graphql: {} })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    const server = await listen(app);

    const created = await request(server)
      .post("/graphql")
      .send({ query: `mutation { createTodo(input: { title: "empty options", done: false }) { id title } }` })
      .expect(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTodo).toEqual({ id: 1, title: "empty options" });
  });

  it("mounts the same way under forRootAsync", async () => {
    // The async form resolves its options through a factory and implies
    // `provideServices`, so the merged schema's container lookups run
    // through a different branch than `forRoot`'s.
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [
        KavoModule.forRootAsync({ useFactory: () => ({ infrastructure: fakeInfrastructure(adapter) }), graphql: true }),
      ],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    const server = await listen(app);

    const created = await request(server)
      .post("/graphql")
      .send({ query: `mutation { createTodo(input: { title: "async", done: false }) { id title } }` })
      .expect(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTodo).toEqual({ id: 1, title: "async" });
  });
});
