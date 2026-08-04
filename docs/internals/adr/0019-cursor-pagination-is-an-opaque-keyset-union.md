# ADR-0019 — `Pagination` becomes a union, and a cursor is opaque rather than signed

**Status:** accepted

## Context

Kavo shipped two pagination strategies, `offset` and `page`, and
`packages/core/src/query/pagination.ts` described the shape they produce as
"the single internal form every strategy produces and every adapter
consumes": `{ limit, offset }`. Every adapter reads `.offset` and hands it
straight to `skip`/`take` (or its ORM's spelling).

Keyset ("cursor") pagination does not fit that form, and three separate
tensions fall out of trying to make it fit.

**There is no offset to report.** A keyset page is defined by "the rows
ordered after _this_ row", not by a count of rows skipped. Reusing the field
with a `0` in it would hand every adapter a number that means nothing and
that a future reader would reasonably `skip()` by. The issue's own
requirement — "an adapter never receives a meaningless `offset`" — is a
requirement about the _type_, and only the type can enforce it. But
`Pagination` is public API, and so are `PaginationStrategy`,
`NormalizedQueryContext`, and `RepositoryAdapter`, which means any change
here is a change adopters see.

**A cursor cannot be tamper-proof in this package.** The obvious design is
an HMAC-signed token. Core imports nothing at all (ADR-0005), which rules
out `node:crypto`; the one cryptographic API reachable as an ambient global,
`SubtleCrypto`, is asynchronous while `PaginationStrategy.normalize` is
synchronous; and `KavoSettings` has no secret-key concept for a signature to
use. Adding all three — a runtime dependency, an async seam, a key
management story — would be a large architectural bill.

**Nothing in a strategy knows the sort.** A cursor is meaningless except
against the order it was issued for, and it is only correct over a _total_
order. But `normalize(rawParams, limits)` sees neither the effective sort
nor the entity metadata, and widening that signature would break every
third-party strategy — the seam's whole point.

## Decision

**1. `Pagination` is a union, and the offset variant keeps its exact shape.**

```ts
type Pagination<Entity = unknown> = OffsetPagination | CursorPagination<Entity>;
interface OffsetPagination {
  limit: number;
  offset: number;
}
interface CursorPagination<Entity = unknown> {
  limit: number;
  cursor: string | null;
  keyset: FilterExpression<Entity> | null;
}
```

The discriminant is the **presence of `cursor`**, exposed as the exported
guard `isCursorPagination`, not a `kind` tag — that keeps `OffsetPagination`
structurally identical to the pre-union shape, so every existing _producer_
(including third-party strategies) stays assignable with no edit. _Consumers_
that read `.offset` must now narrow first; that break is unavoidable, and is
the point.

**2. A cursor is opaque, not signed.** The token is base64url-encoded JSON,
strictly shape-validated on decode: the payload must be an array whose
length equals the effective sort's, and whose every element matches the
corresponding field's declared `FieldKind` (an `enum` value must be in the
declared set, a `date` must parse, a `null` is refused outright). A failure
is the ordinary `KAVO_QUERY_INVALID_VALUE` query issue on field `cursor` —
the same treatment a malformed `page[number]` gets.

**No documentation or code may claim tamper resistance**, because the
weaker guarantee is genuinely sufficient: a cursor payload is a tuple of
comparison values against fields that are on the _sortable_ allowlist, and
therefore on the _filterable_ one. A client can already send
`?filter[createdAt][gt]=…` with any value it likes against those same
fields. A forged cursor grants nothing forging a filter does not, so a
signature would protect nothing that is not already open. Opacity is there
to stop clients from _depending_ on the token's structure, which it does.

**3. The keyset predicate is built in core, as an ordinary filter AST.**
`keysetExpression(sort, values)` produces the row-wise comparison as an `OR`
of `AND` chains — `(a > va) OR (a = va AND b < vb) OR (…)` — flipping to
`LT` for each `desc` key. Consequences:

- mixed `asc`/`desc` sorts work on every adapter at once, because no adapter
  reimplements row-wise comparison;
- composition with the client's filter, with include joins, and with the
  soft-delete scope is free, since every adapter already translates this AST.

Adapters call `readFilter(query)` in `findMany` instead of reading
`query.filter`; it AND-s the keyset onto the client filter (and is the
identity function under offset paging). **`count` deliberately keeps using
`query.filter`** — `total` is the size of the whole match set, so
`pagination.count` behaviour is unchanged and strategy-independent.

**4. Sort validation lives in `QueryNormalizer`, not in the strategy.** The
strategy carries the token through and leaves `keyset` at `null`; the
normalizer — which runs after sort resolution and holds the entity metadata
— enforces the rules and fills `keyset`, on **both** the wire path and the
programmatic one. The rules:

- the effective sort must **end in `idField`**. `EntityMetadata` carries no
  uniqueness information beyond the primary key (composite keys are out of
  scope), so "ends in a unique tiebreaker" can only mean "ends in the
  primary key" — the one field Kavo can prove unique. Declaring other unique
  fields would need a new config key and is deferred.
- every sort field must be a **root scalar column** — a relation path has no
  value to read off the returned row.
- a `json` column may not be a sort key: no portable ordering.
- a **nullable** column is _not_ rejected. Whether an ORM calls a column
  nullable is not a reliable signal (Mongoose reports every non-`required`
  path that way), so rejecting on it would make the feature unusable rather
  than safe. The accurate rule lives in the decoder instead: a cursor may
  not carry `null` for any key, so paging works until it actually reaches a
  row with a null sort key and then fails loudly with a message naming the
  field.

Rejections are `KAVO_QUERY_CONFLICTING_PARAMS` on field `sort`, and are
reported _without_ also decoding the cursor — a cursor checked against a
rejected sort would add a misleading second issue about arity.

**5. `nextCursor` goes in `meta`, and the engine owns it.** The envelope's
fields (`items`, `limit`, `offset`, `total`, `meta`) are normative and do
not grow. The next page's token is `meta.nextCursor`, `null` on the last
page, assembled in `KavoEngine`'s `listMeta` step — the single merge point
for everything that contributes to the list envelope's bag (issue #122).
The strategy's key is the **base** and a handler's `meta` merges over it, so
a `withListMeta` contributor that names `nextCursor` explicitly still wins.

The has-more signal it needs is a **`limit + 1` over-fetch**, and it lives
in the **built-in `findMany` handler**, not in the adapters: the handler
asks the adapter for one row more than the page, drops the sentinel, and
reports `FindManyResult.hasMore`. Putting it there means `EntityReader`'s
contract stays "return exactly what the query asks for", and an adapter —
including a third-party one — needs no cursor awareness beyond honouring
`readFilter`.

**6. `ListResultDto.offset` is `0` on a cursor page.** The field is
non-nullable and normative, and a keyset page genuinely has no absolute
position in the match set. `0` is the honest reading of "how many rows
precede `items[0]` in what this response describes"; cursor clients page
with `meta.nextCursor` and ignore it.

**7. `offset` remains the default strategy.** Backward (`before`) paging and
Relay-style `edges`/`pageInfo` conventions in the protocol bindings are out
of scope.

## Consequences

- **A consumer-side break at v0.6.0.** Any code reading
  `query.pagination.offset` — an adapter, a custom `EntityReader`, a test
  fixture — must narrow with `isCursorPagination` first. Producers are
  unaffected. Kavo versions in lockstep (ADR-0004), so the break lands
  everywhere at once.
- **The base64 codec is hand-rolled.** `packages/core/tsconfig.json` sets
  `"types": []` precisely so a host's ambient globals cannot leak in, which
  rules out `btoa`/`TextEncoder` alongside `Buffer`. The payload is escaped
  to ASCII before encoding, so no UTF-8 encoder is needed; it lives in one
  module, `packages/core/src/query/cursor.ts`, with its own tests.
- **Cursor paging costs one extra row per page**, never an extra query.
- **A cursor is not portable across sorts.** Changing `sort` while holding a
  token is rejected rather than silently reinterpreted — the arity check
  catches the common case, and the type check catches the rest.
