import type { OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { resolveKavoMcpTools, type KavoMcpToolBinding } from "@kavo/mcp";
import { getKavoEntities } from "../kavo.decorator.js";
import { getKavoServiceToken } from "../tokens.js";

/**
 * Nest-side half of the `@kavo/mcp` glue: discovers every `@Kavo` entity
 * and collects the full standard toolset for each into one process-wide
 * toolset — no per-entity opt-in, every `@Kavo` entity gets every standard
 * tool, the same moment `KavoBinder` does its own discovery pass
 * (`onModuleInit`, after every controller file has been imported). All the
 * actual tool-building is `@kavo/mcp`'s `resolveKavoMcpTools` — this class
 * only supplies the one Nest-specific piece that function deliberately
 * doesn't know about: how to resolve one entity's bound service
 * (`ModuleRef` + `getKavoServiceToken`). A future
 * `@kavo/express`/`@kavo/fastify` binding would supply its own version of
 * that and reuse the same `resolveKavoMcpTools` call.
 *
 * Unlike `BaseKavoGraphQLController` (which lazily `import()`s
 * `@kavo/graphql` and the `graphql` peer via `load-graphql.ts`, because
 * `@kavo/graphql` needs `graphql`'s runtime `GraphQLSchema` machinery to
 * build and execute a schema), *this class* never touches
 * `@modelcontextprotocol/sdk` at runtime — `Tool`/`CallToolResult` are
 * consumed as types only (`import type` above, erased at compile time),
 * and every `KavoMcpToolBinding` is a plain object `@kavo/mcp` builds
 * itself. So this file carries no "peer not installed" failure mode to
 * guard against, and it imports `@kavo/mcp` directly, the same way it
 * imports `@kavo/core`. (`createDefaultMcpController` in
 * `default-mcp.controller.ts`, the zero-config controller `KavoModule`'s
 * `mcp` option mounts, is the one place `@kavo/nest` *does* run the SDK at
 * runtime — see `load-mcp-sdk.ts`.)
 *
 * A hand-written concrete controller wires its own
 * `@modelcontextprotocol/sdk` server (`Server`/`McpServer`, whichever
 * transport it wants — stdio, SSE, streamable HTTP) and feeds it
 * `listTools()`/`callTool()`:
 *
 * ```ts
 * @Injectable()
 * export class McpToolset extends BaseKavoMcpController {
 *   constructor(moduleRef: ModuleRef) {
 *     super(moduleRef);
 *   }
 *
 *   tools(): readonly Tool[] {
 *     return this.listTools();
 *   }
 *
 *   run(name: string, args: Record<string, unknown>) {
 *     return this.callTool(name, args);
 *   }
 * }
 * ```
 *
 * `@kavo/mcp` itself stays framework-agnostic — it never imports
 * `@kavo/nest` (`protocol-bindings-only-import-core` in `.dependency-cruiser.cjs`,
 * ADR-0016) — so this class is the only place the two meet.
 */
export abstract class BaseKavoMcpController implements OnModuleInit {
  private bindings: readonly KavoMcpToolBinding[] = [];

  constructor(protected readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    this.bindings = resolveKavoMcpTools(getKavoEntities(), (entity) =>
      this.moduleRef.get(getKavoServiceToken(entity), { strict: false }),
    );
  }

  /** Every tool this process exposes — feed straight into an MCP SDK server's `ListToolsResult`. */
  protected listTools(): readonly Tool[] {
    return this.bindings.map((binding) => binding.tool);
  }

  /** Runs one tool call by name — feed straight into an MCP SDK server's `CallTool` request handler. */
  protected callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const binding = this.bindings.find((candidate) => candidate.tool.name === name);
    if (binding === undefined) {
      return Promise.resolve({ isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] });
    }
    return binding.handler(args);
  }
}
