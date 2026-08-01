import { describe, expect, it, vi } from "vitest";
import { ConfigurationException } from "@kavo/core";

/**
 * Proves the actual bug this file exists to fix: before `loadGraphQL()`,
 * `@kavo/nest`'s always-loaded module graph (`index.ts`, `kavo.module.ts`)
 * statically imported `@kavo/graphql`, which statically imports the
 * `graphql` peer — meaning `import { Kavo } from "@kavo/nest"` itself
 * crashed with a raw `ERR_MODULE_NOT_FOUND` whenever `graphql` (an
 * *optional* peer) wasn't installed, for every app, whether or not it
 * ever touched GraphQL. `vi.mock` stands in for "`graphql` isn't
 * installed": the dynamic `import("@kavo/graphql")` inside `loadGraphQL`
 * fails, and it must turn into a catchable `ConfigurationException` with
 * an actionable message, not an unhandled module-resolution error.
 */
vi.mock("@kavo/graphql", () => {
  throw new Error("Cannot find package 'graphql'");
});

describe("loadGraphQL", () => {
  it("importing @kavo/nest's barrel never touches @kavo/graphql, even when it would throw", async () => {
    // The regression this whole file guards against: this import must not
    // throw, despite the mock above making @kavo/graphql itself explode —
    // proof that no module reachable from the barrel imports it eagerly.
    await expect(import("@kavo/nest")).resolves.toBeDefined();
  });

  it("wraps a failed dynamic import in a ConfigurationException", async () => {
    const { loadGraphQL } = await import("../src/graphql/load-graphql.js");
    await expect(loadGraphQL()).rejects.toThrow(ConfigurationException);
    await expect(loadGraphQL()).rejects.toThrow(/graphql.*package.*installed/i);
  });
});
