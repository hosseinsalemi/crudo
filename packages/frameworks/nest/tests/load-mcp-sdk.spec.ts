import { describe, expect, it, vi } from "vitest";
import { ConfigurationException } from "@kavo/core";

/**
 * The MCP twin of `load-graphql.spec.ts`, and the same bug class.
 * `@modelcontextprotocol/sdk` is an *optional* peer, so nothing in
 * `@kavo/nest`'s always-loaded module graph (`index.ts`,
 * `kavo.module.ts`) may import it eagerly — otherwise `import { Kavo }
 * from "@kavo/nest"` crashes with a raw `ERR_MODULE_NOT_FOUND` for every
 * app that never touches MCP.
 *
 * `@kavo/mcp` itself is imported directly rather than lazily, which is
 * safe because it consumes the SDK for *types only* (doc 16, §5). The
 * default MCP controller is the one place `@kavo/nest` instantiates SDK
 * classes, and it reaches them through `loadMcpSdk`. Mocking the three
 * SDK entry points to throw stands in for "the package is not installed".
 */
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});
vi.mock("@modelcontextprotocol/sdk/types.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});

describe("loadMcpSdk", () => {
  it("importing @kavo/nest's barrel never touches the SDK at runtime, even when it would throw", async () => {
    // The regression worth guarding: this import must resolve despite the
    // mocks above making every SDK entry point explode, which is only true
    // while nothing reachable from the barrel loads the SDK eagerly.
    await expect(import("@kavo/nest")).resolves.toBeDefined();
  });

  it("wraps a failed dynamic import in a ConfigurationException", async () => {
    const { loadMcpSdk } = await import("../src/mcp/load-mcp-sdk.js");
    await expect(loadMcpSdk()).rejects.toThrow(ConfigurationException);
  });

  it("names the package to install and the option to drop", async () => {
    // A raw module-resolution error tells an adopter nothing about which
    // of their choices caused it; this message names both ways out.
    const { loadMcpSdk } = await import("../src/mcp/load-mcp-sdk.js");
    await expect(loadMcpSdk()).rejects.toThrow(/@modelcontextprotocol\/sdk/);
    await expect(loadMcpSdk()).rejects.toThrow(/install/i);
  });

  it("stays failed on a second call rather than retrying the import", async () => {
    // The result is cached either way; a missing package does not become
    // present mid-process, so re-attempting the import per request would
    // only add latency to an error path.
    const { loadMcpSdk } = await import("../src/mcp/load-mcp-sdk.js");
    await expect(loadMcpSdk()).rejects.toThrow(ConfigurationException);
    await expect(loadMcpSdk()).rejects.toThrow(ConfigurationException);
  });
});
