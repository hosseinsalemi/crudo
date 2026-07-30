import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Crud, KavoModule, BaseCrudGraphQLController } from "@kavo/nest";
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
 * Proves `BaseCrudGraphQLController` end to end: a concrete controller
 * that only adds `@Controller`/`@Post` discovers `Todo` through
 * `getCrudEntities()` + `registerCrudGraphQLTypes`, merges it onto one
 * schema at `onModuleInit`, and resolves through the exact
 * `DefaultCrudService` REST binds to. Vitest isolates modules per file, so
 * this is a safe place for a single `@Crud(Todo)` registration (same
 * reasoning as `for-feature-registry.e2e.spec.ts`).
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

@Controller("graphql")
class GraphQLController extends BaseCrudGraphQLController {
  constructor(moduleRef: ModuleRef) {
    super(moduleRef);
  }

  @Post()
  @HttpCode(200)
  handle(@Body() body: { query: string; variables?: Record<string, unknown> }) {
    return this.execute(body.query, body.variables);
  }
}

let app: INestApplication;

afterEach(async () => {
  await app.close();
});

describe("BaseCrudGraphQLController", () => {
  it("discovers @Crud(Todo) and resolves a mutation + query against the merged schema", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), provideServices: true })],
      controllers: [TodoController, GraphQLController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/graphql")
      .send({ query: `mutation { createTodo(input: { title: "from graphql", done: false }) { id title } }` })
      .expect(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTodo).toEqual({ id: 1, title: "from graphql" });

    const fetched = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/graphql")
      .send({ query: `query { todo(id: 1) { title done } }` })
      .expect(200);
    expect(fetched.body.errors).toBeUndefined();
    expect(fetched.body.data.todo).toEqual({ title: "from graphql", done: false });
  });
});
