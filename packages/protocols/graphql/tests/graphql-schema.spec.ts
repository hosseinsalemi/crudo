import { describe, expect, it } from "vitest";
import { createKavo } from "@kavo/core";
import {
  GraphQLBoolean,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  graphql,
} from "graphql";
import {
  createKavoGraphQLSchema,
  getKavoGraphQLTypes,
  mergeKavoGraphQLSchemas,
  registerKavoGraphQLTypes,
} from "@kavo/graphql";
import {
  InMemoryNoteAdapter,
  InMemoryTagAdapter,
  InMemoryTodoAdapter,
  Note,
  noteMetadata,
  Tag,
  tagMetadata,
  Todo,
  todoMetadata,
} from "./support/todo-fixture.js";

/**
 * Proves the binding end to end: a schema built by `createKavoGraphQLSchema`
 * resolves queries and mutations by calling straight into the same
 * `createCrud` service REST would bind to — no parallel pipeline, no
 * database, just the in-memory adapter core's own tests use.
 */
describe("createKavoGraphQLSchema", () => {
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

  function setup() {
    const adapter = new InMemoryTodoAdapter();
    const service = createKavo().createCrud(Todo, undefined, { adapter, metadata: todoMetadata });
    const schema = createKavoGraphQLSchema({
      name: "Todo",
      service,
      itemType: TodoType,
      createInputType: CreateTodoInput,
    });
    return { adapter, schema };
  }

  it("resolves a mutation and a follow-up query through the same engine", async () => {
    const { schema } = setup();

    const created = await graphql({
      schema,
      source: `mutation { createTodo(input: { title: "write tests", done: false }) { id title done } }`,
    });
    expect(created.errors).toBeUndefined();
    expect(created.data?.createTodo).toEqual({ id: 1, title: "write tests", done: false });

    const fetched = await graphql({ schema, source: `query { todo(id: 1) { id title } }` });
    expect(fetched.errors).toBeUndefined();
    expect(fetched.data?.todo).toEqual({ id: 1, title: "write tests" });
  });

  it("resolves the list query with pagination envelope fields", async () => {
    const { adapter, schema } = setup();
    adapter.rows.push({ id: 1, title: "a", done: false }, { id: 2, title: "b", done: true });

    const result = await graphql({
      schema,
      source: `query { todos(limit: 1, offset: 1) { items { id title } total limit offset } }`,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.todos).toEqual({
      items: [{ id: 2, title: "b" }],
      total: 2,
      limit: 1,
      offset: 1,
    });
  });

  it("merges multiple entities onto one Query/Mutation root without collisions", async () => {
    const todoAdapter = new InMemoryTodoAdapter();
    const todoService = createKavo().createCrud(Todo, undefined, { adapter: todoAdapter, metadata: todoMetadata });
    const tagAdapter = new InMemoryTagAdapter();
    const tagService = createKavo().createCrud(Tag, undefined, { adapter: tagAdapter, metadata: tagMetadata });

    const TagType = new GraphQLObjectType({
      name: "Tag",
      fields: {
        id: { type: new GraphQLNonNull(GraphQLInt) },
        label: { type: new GraphQLNonNull(GraphQLString) },
      },
    });
    const CreateTagInput = new GraphQLInputObjectType({
      name: "CreateTagInput",
      fields: { label: { type: new GraphQLNonNull(GraphQLString) } },
    });

    const schema = mergeKavoGraphQLSchemas([
      { name: "Todo", service: todoService, itemType: TodoType, createInputType: CreateTodoInput },
      { name: "Tag", service: tagService, itemType: TagType, createInputType: CreateTagInput },
    ]);

    const created = await graphql({
      schema,
      source: `mutation {
        createTodo(input: { title: "one endpoint", done: false }) { id title }
        createTag(input: { label: "urgent" }) { id label }
      }`,
    });
    expect(created.errors).toBeUndefined();
    expect(created.data).toEqual({
      createTodo: { id: 1, title: "one endpoint" },
      createTag: { id: 1, label: "urgent" },
    });

    const fetched = await graphql({ schema, source: `query { todo(id: 1) { title } tag(id: 1) { label } }` });
    expect(fetched.errors).toBeUndefined();
    expect(fetched.data).toEqual({ todo: { title: "one endpoint" }, tag: { label: "urgent" } });
  });

  it("omits the mutation type when no createInputType is supplied", () => {
    const service = createKavo().createCrud(Todo, undefined, {
      adapter: new InMemoryTodoAdapter(),
      metadata: todoMetadata,
    });
    const schema = createKavoGraphQLSchema({ name: "Todo", service, itemType: TodoType });
    expect(schema.getMutationType()).toBeUndefined();
  });

  it("registers and retrieves GraphQL types per entity, letting a consumer discover them by class", () => {
    expect(getKavoGraphQLTypes(Tag)).toBeUndefined();

    registerKavoGraphQLTypes(Tag, { itemType: TodoType });
    expect(getKavoGraphQLTypes(Tag)).toEqual({ itemType: TodoType });
  });

  it("resolves update/patch/delete mutations through the same engine", async () => {
    const adapter = new InMemoryTodoAdapter();
    adapter.rows.push({ id: 1, title: "before", done: false });
    const service = createKavo().createCrud(Todo, undefined, { adapter, metadata: todoMetadata });

    const UpdateTodoInput = new GraphQLInputObjectType({
      name: "UpdateTodoInput",
      fields: {
        title: { type: new GraphQLNonNull(GraphQLString) },
        done: { type: new GraphQLNonNull(GraphQLBoolean) },
      },
    });
    const PatchTodoInput = new GraphQLInputObjectType({
      name: "PatchTodoInput",
      fields: { done: { type: GraphQLBoolean } },
    });

    const schema = createKavoGraphQLSchema({
      name: "Todo",
      service,
      itemType: TodoType,
      updateInputType: UpdateTodoInput,
      patchInputType: PatchTodoInput,
      deleteOne: true,
    });

    const updated = await graphql({
      schema,
      source: `mutation { updateTodo(id: 1, input: { title: "after", done: true }) { title done } }`,
    });
    expect(updated.errors).toBeUndefined();
    expect(updated.data?.updateTodo).toEqual({ title: "after", done: true });

    const patched = await graphql({ schema, source: `mutation { patchTodo(id: 1, input: { done: false }) { done } }` });
    expect(patched.errors).toBeUndefined();
    expect(patched.data?.patchTodo).toEqual({ done: false });

    const deleted = await graphql({ schema, source: `mutation { deleteTodo(id: 1) }` });
    expect(deleted.errors).toBeUndefined();
    expect(deleted.data?.deleteTodo).toBe(true);

    const afterDelete = await graphql({ schema, source: `query { todo(id: 1) { id } }` });
    expect(afterDelete.errors?.[0]?.message).toMatch(/not found/i);
  });

  it("forwards sort and filter args through to the normalized query", async () => {
    const { adapter, schema } = setup();
    adapter.rows.push({ id: 1, title: "a", done: false }, { id: 2, title: "b", done: true });

    const result = await graphql({
      schema,
      source: `query {
        todos(sort: ["-title"], filter: { kind: "condition", field: "done", operator: "EQ", value: true }) {
          items { id }
        }
      }`,
    });

    expect(result.errors).toBeUndefined();
    expect(adapter.lastQuery?.sort).toEqual([{ field: "title", direction: "desc" }]);
    expect(adapter.lastQuery?.filter.root).toEqual({ kind: "condition", field: "done", operator: "EQ", value: true });
  });

  it("resolves restore/purge mutations against a soft-deletable entity", async () => {
    const adapter = new InMemoryNoteAdapter();
    const service = createKavo().createCrud(
      Note,
      { softDelete: { strategy: "soft" }, operations: { purgeOne: true } },
      { adapter, metadata: noteMetadata },
    );
    const created = await service.createOne({ text: "keep me" } as never);
    await service.deleteOne(created.id as never);

    const NoteType = new GraphQLObjectType({
      name: "Note",
      fields: {
        id: { type: new GraphQLNonNull(GraphQLInt) },
        text: { type: new GraphQLNonNull(GraphQLString) },
      },
    });

    const schema = createKavoGraphQLSchema({
      name: "Note",
      service,
      itemType: NoteType,
      restoreOne: true,
      purgeOne: true,
    });

    const restored = await graphql({ schema, source: `mutation { restoreNote(id: ${created.id}) { id text } }` });
    expect(restored.errors).toBeUndefined();
    expect(restored.data?.restoreNote).toEqual({ id: created.id, text: "keep me" });

    const purged = await graphql({ schema, source: `mutation { purgeNote(id: ${created.id}) }` });
    expect(purged.errors).toBeUndefined();
    expect(purged.data?.purgeNote).toBe(true);

    expect(adapter.rows).toHaveLength(0);
  });
});
