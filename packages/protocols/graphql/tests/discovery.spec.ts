import { describe, expect, it } from "vitest";
import { ConfigurationException, createKavo } from "@kavo/core";
import { graphql, GraphQLInt, GraphQLNonNull, GraphQLObjectType, GraphQLString } from "graphql";
import { registerCrudGraphQLTypes, resolveCrudGraphQLSchema } from "@kavo/graphql";
import { InMemoryTodoAdapter, Todo, todoMetadata } from "./support/todo-fixture.js";

/**
 * `resolveCrudGraphQLSchema` is the host-agnostic half of the discovery
 * pipeline `@kavo/nest`'s `BaseCrudGraphQLController` uses — this proves it
 * directly, with a plain array standing in for a host's own entity
 * registry and a plain `Map` standing in for a host's DI container, so the
 * test never has to touch Nest at all.
 */
describe("resolveCrudGraphQLSchema", () => {
  const TodoType = new GraphQLObjectType({
    name: "Todo",
    fields: {
      id: { type: new GraphQLNonNull(GraphQLInt) },
      title: { type: new GraphQLNonNull(GraphQLString) },
    },
  });

  it("skips entities with no registered GraphQL types and resolves the rest via the caller's callback", async () => {
    class Unregistered {}

    registerCrudGraphQLTypes(Todo, { itemType: TodoType });

    const adapter = new InMemoryTodoAdapter();
    adapter.rows.push({ id: 1, title: "discovered", done: false });
    const todoService = createKavo().createCrud(Todo, undefined, { adapter, metadata: todoMetadata });

    const services = new Map<unknown, unknown>([[Todo, todoService]]);
    const schema = resolveCrudGraphQLSchema(
      [{ entity: Unregistered }, { entity: Todo }],
      (entity) => services.get(entity) as never,
    );

    expect(schema.getQueryType()?.getFields()["unregistered"]).toBeUndefined();

    const result = await graphql({ schema, source: `query { todo(id: 1) { title } }` });
    expect(result.errors).toBeUndefined();
    expect(result.data?.todo).toEqual({ title: "discovered" });
  });

  it("fails fast at schema-build time when no entity registered any GraphQL types", () => {
    class Unregistered {}

    expect(() => resolveCrudGraphQLSchema([{ entity: Unregistered }], () => ({}) as never)).toThrow(
      ConfigurationException,
    );
  });
});
