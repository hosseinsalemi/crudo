import { ConfigurationException } from "@kavo/core";

interface LazyMcpSdk {
  readonly Server: typeof import("@modelcontextprotocol/sdk/server/index.js").Server;
  readonly StreamableHTTPServerTransport: typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
  readonly ListToolsRequestSchema: typeof import("@modelcontextprotocol/sdk/types.js").ListToolsRequestSchema;
  readonly CallToolRequestSchema: typeof import("@modelcontextprotocol/sdk/types.js").CallToolRequestSchema;
}

let cached: LazyMcpSdk | null | undefined;

/**
 * Lazily loads the *runtime* pieces of `@modelcontextprotocol/sdk` that the
 * default MCP controller (`createDefaultMcpController`) needs to actually
 * run a `Server` over a `StreamableHTTPServerTransport` — unlike
 * `BaseKavoMcpController`/`@kavo/mcp`, which only ever consume the SDK's
 * *types* (doc 16, §5), this file exists because the default controller is
 * the one place `@kavo/nest` genuinely instantiates SDK classes. Mirrors
 * `load-graphql.ts` for the identical reason: `@modelcontextprotocol/sdk`
 * is an *optional* peer, so nothing in `@kavo/nest`'s always-loaded module
 * graph (`index.ts`, `kavo.module.ts`) may import it eagerly — only code a
 * consumer reaches by opting in (`KavoModule`'s `mcp` option) does.
 */
export async function loadMcpSdk(): Promise<LazyMcpSdk> {
  if (cached === undefined) {
    try {
      const [serverModule, transportModule, typesModule] = await Promise.all([
        import("@modelcontextprotocol/sdk/server/index.js"),
        import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
        import("@modelcontextprotocol/sdk/types.js"),
      ]);
      cached = {
        Server: serverModule.Server,
        StreamableHTTPServerTransport: transportModule.StreamableHTTPServerTransport,
        ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
        CallToolRequestSchema: typesModule.CallToolRequestSchema,
      };
    } catch {
      cached = null;
    }
  }
  if (cached === null) {
    throw new ConfigurationException(
      "Mcp",
      "mcp",
      "MCP support requires the `@modelcontextprotocol/sdk` package to be installed " +
        "(an optional peer of @kavo/nest) — install it, or don't set KavoModule's `mcp` option.",
    );
  }
  return cached;
}
