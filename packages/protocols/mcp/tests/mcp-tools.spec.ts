import { describe, expect, it } from "vitest";
import { ConfigurationException, createKavo } from "@kavo/core";
import { crudTools } from "@kavo/mcp";
import {
  InMemoryNoteAdapter,
  InMemoryTodoAdapter,
  Note,
  noteMetadata,
  Todo,
  todoMetadata,
} from "./support/todo-fixture.js";

/**
 * Proves the binding end to end: a toolset built by `crudTools` calls
 * straight into the same `createCrud` service REST would bind to — no
 * parallel pipeline, no database, just the in-memory adapter core's own
 * tests use. There is no per-entity config: every entity gets the full
 * standard toolset unconditionally.
 */
describe("crudTools", () => {
  function setup() {
    const adapter = new InMemoryTodoAdapter();
    const service = createKavo().createCrud(Todo, undefined, { adapter, metadata: todoMetadata });
    const bindings = crudTools({ name: "Todo", service });
    return { adapter, bindings };
  }

  function find(bindings: ReturnType<typeof setup>["bindings"], name: string) {
    const binding = bindings.find((candidate) => candidate.tool.name === name);
    if (binding === undefined) throw new Error(`no tool named ${name}`);
    return binding;
  }

  it("produces the full standard toolset unconditionally, no per-entity config", () => {
    const { bindings } = setup();
    expect(bindings.map((binding) => binding.tool.name).sort()).toEqual(
      [
        "todo.createOne",
        "todo.deleteOne",
        "todo.findMany",
        "todo.findOne",
        "todo.patchOne",
        "todo.purgeOne",
        "todo.restoreOne",
        "todo.updateOne",
      ].sort(),
    );
  });

  it("runs createOne then findOne through the same engine, returning JSON text content", async () => {
    const { bindings } = setup();

    const created = await find(bindings, "todo.createOne").handler({ title: "write tests", done: false });
    expect(created.isError).toBeUndefined();
    expect(JSON.parse((created.content[0] as { text: string }).text)).toEqual({
      id: 1,
      title: "write tests",
      done: false,
    });

    const fetched = await find(bindings, "todo.findOne").handler({ id: 1 });
    expect(JSON.parse((fetched.content[0] as { text: string }).text)).toMatchObject({ id: 1, title: "write tests" });
  });

  it("runs findMany with pagination, sort, and filter forwarded to the normalized query", async () => {
    const { adapter, bindings } = setup();
    adapter.rows.push({ id: 1, title: "a", done: false }, { id: 2, title: "b", done: true });

    const result = await find(bindings, "todo.findMany").handler({
      limit: 1,
      offset: 1,
      sort: ["-title"],
      filter: { kind: "condition", field: "done", operator: "EQ", value: true },
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.items).toEqual([{ id: 2, title: "b", done: true }]);
    expect(adapter.lastQuery?.sort).toEqual([{ field: "title", direction: "desc" }]);
    expect(adapter.lastQuery?.filter.root).toEqual({ kind: "condition", field: "done", operator: "EQ", value: true });
  });

  it("runs update, patch, and delete through the same engine", async () => {
    const { adapter, bindings } = setup();
    adapter.rows.push({ id: 1, title: "before", done: false });

    const updated = await find(bindings, "todo.updateOne").handler({ id: 1, title: "after", done: true });
    expect(JSON.parse((updated.content[0] as { text: string }).text)).toMatchObject({ title: "after", done: true });

    const patched = await find(bindings, "todo.patchOne").handler({ id: 1, done: false });
    expect(JSON.parse((patched.content[0] as { text: string }).text)).toMatchObject({ done: false });

    const deleted = await find(bindings, "todo.deleteOne").handler({ id: 1 });
    expect(JSON.parse((deleted.content[0] as { text: string }).text)).toEqual({ deleted: true });
    expect(adapter.rows).toHaveLength(0);
  });

  it("maps a KavoException (not found) to an isError tool result instead of throwing", async () => {
    const { bindings } = setup();

    const result = await find(bindings, "todo.findOne").handler({ id: 999 });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("KAVO_NOT_FOUND");
  });

  it("maps restore/purge on a non-soft-deletable entity to an isError result (still produced unconditionally)", async () => {
    const { adapter, bindings } = setup();
    adapter.rows.push({ id: 1, title: "a", done: false });

    const restored = await find(bindings, "todo.restoreOne").handler({ id: 1 });
    expect(restored.isError).toBe(true);
  });

  it("resolves restore/purge tools against a soft-deletable entity", async () => {
    const adapter = new InMemoryNoteAdapter();
    const service = createKavo().createCrud(
      Note,
      { softDelete: { strategy: "soft" }, operations: { purgeOne: true } },
      { adapter, metadata: noteMetadata },
    );
    const created = await service.createOne({ text: "keep me" } as never);
    await service.deleteOne(created.id as never);

    const bindings = crudTools({ name: "Note", service });

    const restored = await find(bindings, "note.restoreOne").handler({ id: created.id });
    expect(JSON.parse((restored.content[0] as { text: string }).text)).toMatchObject({
      id: created.id,
      text: "keep me",
    });

    const purged = await find(bindings, "note.purgeOne").handler({ id: created.id });
    expect(JSON.parse((purged.content[0] as { text: string }).text)).toEqual({ purged: true });
    expect(adapter.rows).toHaveLength(0);
  });
});

describe("cursor-paginated entities are refused at bootstrap", () => {
  /** `<entity>.findMany` exposes `limit`/`offset` only, and a keyset ignores `offset` (ADR-0021 §7). */
  function cursorTodoService() {
    return createKavo({
      defaults: {
        pagination: { strategy: "cursor" },
        query: { defaultSort: [{ field: "id", direction: "asc" }] },
      },
    } as never).createCrud(Todo, undefined, { adapter: new InMemoryTodoAdapter(), metadata: todoMetadata });
  }

  it("throws rather than silently answering a paged findMany with page one", () => {
    expect(() => crudTools({ name: "Todo", service: cursorTodoService() })).toThrow(ConfigurationException);
  });

  it("names the entity, the config key, and the way out", () => {
    expect(() => crudTools({ name: "Todo", service: cursorTodoService() })).toThrow(/pagination\.strategy/);
    expect(() => crudTools({ name: "Todo", service: cursorTodoService() })).toThrow(/'offset'\/'page'/);
  });

  it("still binds an offset-paginated entity", () => {
    const service = createKavo().createCrud(Todo, undefined, {
      adapter: new InMemoryTodoAdapter(),
      metadata: todoMetadata,
    });
    expect(() => crudTools({ name: "Todo", service })).not.toThrow();
  });
});
