import { describe, expect, it } from "vitest";
import { createKavo } from "@kavo/core";
import { resolveKavoMcpTools } from "@kavo/mcp";
import { InMemoryTodoAdapter, Todo, todoMetadata } from "./support/todo-fixture.js";

/**
 * `resolveKavoMcpTools` is the host-agnostic half of the discovery
 * pipeline a Nest MCP controller uses — this proves it directly, with a
 * plain array standing in for a host's own entity registry and a plain
 * `Map` standing in for a host's DI container, so the test never has to
 * touch Nest at all.
 */
describe("resolveKavoMcpTools", () => {
  it("collects every entity's full standard toolset via the caller's callback", async () => {
    const adapter = new InMemoryTodoAdapter();
    adapter.rows.push({ id: 1, title: "discovered", done: false });
    const todoService = createKavo().createCrud(Todo, undefined, { adapter, metadata: todoMetadata });

    const services = new Map<unknown, unknown>([[Todo, todoService]]);
    const bindings = resolveKavoMcpTools([{ entity: Todo }], (entity) => services.get(entity) as never);

    expect(bindings.map((binding) => binding.tool.name)).toContain("todo.findOne");
    expect(bindings.map((binding) => binding.tool.name)).toHaveLength(8);

    const findOne = bindings.find((binding) => binding.tool.name === "todo.findOne");
    const result = await findOne!.handler({ id: 1 });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ title: "discovered" });
  });

  it("returns an empty toolset (not an error) when given no entities", () => {
    expect(resolveKavoMcpTools([], () => ({}) as never)).toEqual([]);
  });
});
