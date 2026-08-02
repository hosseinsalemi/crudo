import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Kavo, KavoModule } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

/**
 * Proves the zero-controller path: `KavoModule.forRoot({ mcp: true })`
 * mounts `POST /mcp` on its own, speaking the MCP Streamable HTTP
 * transport in stateless mode — no `McpController` anywhere in this file,
 * unlike `base-kavo-mcp.controller.e2e.spec.ts`, which covers the opt-out
 * (a hand-written controller extending `BaseKavoMcpController`). Every
 * `@Kavo` entity gets the full standard toolset unconditionally — no
 * per-entity MCP config.
 */
@Kavo(Todo)
@Controller("todos")
class TodoController {}

let app: INestApplication;

afterEach(async () => {
  await app.close();
});

function mcpRequest(app: INestApplication, path = "/mcp") {
  return request(app.getHttpServer() as Parameters<typeof request>[0])
    .post(path)
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
}

describe("KavoModule.forRoot({ mcp: true })", () => {
  it("mounts POST /mcp with no controller of its own, resolving tools/list and tools/call", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), mcp: true })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const listed = await mcpRequest(app).send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    const toolNames = (listed.body.result.tools as { name: string }[]).map((tool) => tool.name).sort();
    expect(toolNames).toEqual(
      [
        "todo_createOne",
        "todo_deleteOne",
        "todo_findMany",
        "todo_findOne",
        "todo_patchOne",
        "todo_purgeOne",
        "todo_restoreOne",
        "todo_updateOne",
      ].sort(),
    );

    const called = await mcpRequest(app).send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "todo_createOne", arguments: { title: "from mcp http", done: false } },
    });
    expect(called.status).toBe(200);
    expect(called.body.result.isError).toBeUndefined();
    const created = JSON.parse(called.body.result.content[0].text);
    expect(created).toMatchObject({ id: 1, title: "from mcp http", done: false });
  });

  it("mounts at a custom path when { path } is given instead of true", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), mcp: { path: "api/mcp" } })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await mcpRequest(app, "/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }).expect(404);

    const listed = await mcpRequest(app, "/api/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    expect((listed.body.result.tools as { name: string }[]).map((tool) => tool.name).sort()).toEqual(
      [
        "todo_createOne",
        "todo_deleteOne",
        "todo_findMany",
        "todo_findOne",
        "todo_patchOne",
        "todo_purgeOne",
        "todo_restoreOne",
        "todo_updateOne",
      ].sort(),
    );
  });

  it("mounts no controller at all when mcp is left unset", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter) })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await mcpRequest(app).send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }).expect(404);
  });

  it("maps a not-found id to an isError tool result over HTTP", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), mcp: true })],
      controllers: [TodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const called = await mcpRequest(app).send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "todo_findOne", arguments: { id: 999 } },
    });
    expect(called.status).toBe(200);
    expect(called.body.result.isError).toBe(true);
    expect(called.body.result.content[0].text).toContain("KAVO_NOT_FOUND");
  });
});
