import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import { Controller, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Kavo, KavoModule, BaseKavoMcpController } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

/**
 * Proves `BaseKavoMcpController` end to end: a concrete class that only
 * adds `@Injectable` discovers `Todo` through `getKavoEntities()`,
 * collects it into one toolset at `onModuleInit` (the full standard
 * toolset, unconditionally — no per-entity config), and resolves through
 * the exact `DefaultKavoService` REST binds to.
 */
@Kavo(Todo)
@Controller("todos")
class TodoController {}

@Injectable()
class McpToolset extends BaseKavoMcpController {
  constructor(moduleRef: ModuleRef) {
    super(moduleRef);
  }

  tools() {
    return this.listTools();
  }

  run(name: string, args: Record<string, unknown>) {
    return this.callTool(name, args);
  }
}

let app: INestApplication;

afterEach(async () => {
  await app.close();
});

describe("BaseKavoMcpController", () => {
  it("discovers @Kavo(Todo) and runs createOne/findOne through the same engine", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), provideServices: true })],
      controllers: [TodoController],
      providers: [McpToolset],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const toolset = app.get(McpToolset);
    expect(
      toolset
        .tools()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(
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

    const created = await toolset.run("todo.createOne", { title: "from mcp", done: false });
    expect(created.isError).toBeUndefined();
    expect(JSON.parse((created.content[0] as { text: string }).text)).toMatchObject({ title: "from mcp" });

    const fetched = await toolset.run("todo.findOne", { id: 1 });
    expect(JSON.parse((fetched.content[0] as { text: string }).text)).toMatchObject({ title: "from mcp" });
  });

  it("maps a not-found id to an isError tool result instead of throwing", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), provideServices: true })],
      controllers: [TodoController],
      providers: [McpToolset],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const toolset = app.get(McpToolset);
    const result = await toolset.run("todo.findOne", { id: 999 });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("KAVO_NOT_FOUND");
  });

  it("returns an isError result for an unknown tool name", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), provideServices: true })],
      controllers: [TodoController],
      providers: [McpToolset],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const toolset = app.get(McpToolset);
    const result = await toolset.run("nonexistent_tool", {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Unknown tool");
  });
});
