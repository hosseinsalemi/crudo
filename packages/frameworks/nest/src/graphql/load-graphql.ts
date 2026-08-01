import { ConfigurationException } from "@kavo/core";

interface LazyGraphQL {
  readonly resolveKavoGraphQLSchema: typeof import("@kavo/graphql").resolveKavoGraphQLSchema;
  readonly graphql: typeof import("graphql").graphql;
}

let cached: LazyGraphQL | null | undefined;

/**
 * Lazily loads `@kavo/graphql` and the `graphql` peer — mirrors
 * `swagger.ts`'s `loadSwagger()` for the same reason: `graphql` is an
 * *optional* peer (`package.json`'s `peerDependenciesMeta`), so nothing in
 * `@kavo/nest`'s always-loaded module graph (`index.ts`, `kavo.module.ts`)
 * may import it eagerly — doing so would make `import { Kavo } from
 * "@kavo/nest"` itself crash for every app that never touches GraphQL,
 * whenever `graphql` happens not to be installed.
 *
 * Unlike `@nestjs/swagger` (published as CommonJS, loadable via
 * `loadSwagger()`'s synchronous `require`), `@kavo/graphql` is Kavo's own
 * ESM package — Node cannot `require()` an ES module synchronously, so a
 * dynamic `import()` is the only correct lazy-load here, which is why this
 * (and `BaseKavoGraphQLController.onModuleInit`/`execute`) is async.
 *
 * Called only from code a consumer reaches by opting in — extending
 * `BaseKavoGraphQLController`, or setting `KavoModule`'s `graphql` option
 * — never from `index.ts` or `kavo.module.ts` directly.
 */
export async function loadGraphQL(): Promise<LazyGraphQL> {
  if (cached === undefined) {
    try {
      const [kavoGraphql, graphqlJs] = await Promise.all([import("@kavo/graphql"), import("graphql")]);
      cached = { resolveKavoGraphQLSchema: kavoGraphql.resolveKavoGraphQLSchema, graphql: graphqlJs.graphql };
    } catch {
      cached = null;
    }
  }
  if (cached === null) {
    throw new ConfigurationException(
      "GraphQL",
      "graphql",
      "GraphQL support requires the `graphql` package to be installed " +
        "(an optional peer of @kavo/nest) — install it, or don't extend " +
        "BaseKavoGraphQLController / set `graphql` on KavoModule.",
    );
  }
  return cached;
}
