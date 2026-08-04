import { expectTypeOf } from "vitest";
import { builtInHandlers, createKavo, withListMeta } from "@kavo/core";
import type { FindManyResult, KavoContext, ListMetaContributor, RepositoryAdapter } from "@kavo/core";
import { Author } from "../support/blog-fixture.js";

/**
 * Type-level acceptance for the `ListResultDto.meta` seam (issue #122).
 * Nothing here executes — `vitest.config.ts` collects `*.spec.ts` only —
 * so every assertion below is `tsc`'s alone.
 *
 * The load-bearing claim is the last block: `withListMeta` must compose
 * with what an adopter actually has in hand (`builtInHandlers(...)`) and
 * drop straight into `operations.findMany.handler` with no cast. A
 * signature that forced one would make the helper more boilerplate than
 * the wrap-and-spread it exists to replace.
 */

declare const adapter: RepositoryAdapter<Author>;

// `meta` is optional: every handler written before it existed still
// satisfies the contract, which is what makes the field additive.
const withoutMeta: FindManyResult<Author> = { entities: [], total: 0 };
const withMeta: FindManyResult<Author> = { entities: [], total: 0, meta: { facets: { draft: 2 } } };
void withoutMeta;
void withMeta;

// The contributor sees the real result and the real context, both bound
// to the entity — so `result.entities` is `Author[]`, not `unknown[]`.
const contributor: ListMetaContributor<Author> = (result, context) => {
  expectTypeOf(result).toEqualTypeOf<FindManyResult<Author>>();
  expectTypeOf(context).toEqualTypeOf<KavoContext<Author>>();
  return { authors: result.entities.map((author) => author.name).join(",") };
};

// @ts-expect-error — a contributor returns a metadata bag, not a scalar.
const badContributor: ListMetaContributor<Author> = () => 42;
void badContributor;

const kavo = createKavo();

// The documented main path: wrap the built-in handler, hand the result
// straight to `operations.findMany.handler`. No cast anywhere.
void kavo.createCrud(Author, {
  operations: {
    findMany: { handler: withListMeta(builtInHandlers(adapter)("findMany"), contributor) },
  },
});

// Entity is inferred from the wrapped handler, so an inline contributor
// is typed without an explicit type argument. The body has to *use* the
// element type for that to be a real claim — `result.entities.length`
// compiles just as happily against `readonly unknown[]`, so it would pass
// even if inference collapsed to `unknown`.
void kavo.createCrud(Author, {
  operations: {
    findMany: {
      handler: withListMeta(builtInHandlers(adapter)("findMany"), (result) => {
        expectTypeOf(result.entities).toEqualTypeOf<readonly Author[]>();
        return { names: result.entities.map((author) => author.name).join(",") };
      }),
    },
  },
});
