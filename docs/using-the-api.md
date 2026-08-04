# Using the generated API

[Getting started](/getting-started) shows the routes `@Kavo()` generates. This page is how to actually call them as a client: the query-string grammar for filtering, sorting, pagination, field selection, and includes, plus the shape of an error response.

## Filtering

```
GET /books?filter[title][eq]=Dune
```

`filter[<field>][<operator>]=<value>`. Multiple `filter[...]` params AND together implicitly, and multiple operators on the same field also AND:

```
GET /books?filter[pages][gte]=200&filter[pages][lt]=500
```

| Operator              | Wire token   | Example                                            |
| --------------------- | ------------ | -------------------------------------------------- |
| Equals                | `eq`         | `filter[status][eq]=active`                        |
| Not equals            | `ne`         | `filter[status][ne]=banned`                        |
| Greater/equal         | `gt` / `gte` | `filter[age][gte]=18`                              |
| Less/equal            | `lt` / `lte` | `filter[age][lt]=65`                               |
| In list               | `in`         | `filter[status][in]=active,pending`                |
| Not in list           | `notIn`      | `filter[role][notIn]=bot,test`                     |
| Like                  | `like`       | `filter[name][like]=%25john%25`                    |
| Case-insensitive like | `ilike`      | `filter[name][ilike]=%25john%25`                   |
| Between               | `between`    | `filter[createdAt][between]=2026-01-01,2026-06-01` |
| Is null               | `isNull`     | `filter[deletedAt][isNull]=true`                   |
| Is not null           | `isNotNull`  | `filter[deletedAt][isNotNull]=true`                |

Wire tokens are exact-case (`gte`, not `GTE`) — a misspelled or wrong-case operator is a 400, not silently ignored. `like`/`ilike` never auto-wrap wildcards; pass `%` yourself, and escape any literal `%`/`_` in the value with a backslash. Both apply to string columns only.

`in`/`notIn` also accept the repeated-key form instead of a comma list, which is friendlier to URL-building libraries:

```
GET /books?filter[status][in][]=active&filter[status][in][]=pending
```

`between` takes exactly two comma-separated bounds. `isNull`/`isNotNull` are boolean-valued — `isNull=false` means the same thing as `isNotNull=true`, so pick whichever reads better.

Only fields on the entity's `filterable` allowlist can be filtered on — see [Configuration](/integrations/nest/configuration#allowlists) for how to configure that list. Anything outside it is a 400, never a silent no-op.

**OR / NOT / nested logic** uses the same bracket grammar and can be nested arbitrarily deep (up to `query.maxFilterDepth`, default 3):

```
GET /books?filter[or][0][author][eq]=Tolkien&filter[or][1][author][eq]=Herbert
GET /books?filter[not][status][eq]=banned
```

For anything the bracket grammar gets awkward at, `filter` also accepts one JSON-encoded value as a full-power escape hatch. It parses into exactly the same filter tree as the bracket form, so the two are interchangeable — and if both are present on a request, they AND together:

```
GET /books?filter={"or":[{"author":{"eq":"Tolkien"}},{"not":{"status":{"eq":"banned"}}}]}
```

**Relation-path filtering** uses dot notation and restricts root rows without loading the related collection — it never filters _what's inside_ an included relation, only which root rows come back:

```
GET /books?filter[author.country][eq]=UK
```

**Limits** guard every request, configurable per scope: `query.maxFilterDepth` (default 3) caps how deeply `or`/`not` can nest, `query.maxInValues` (default 100) caps `in`/`notIn` array length, and `pagination.maxLimit` (default 100) caps page size. Filter/sort/fields/pagination violations on one request are collected together and reported in a single response — see [Errors](#errors) below.

## Sorting

```
GET /books?sort=-publishedAt,title
```

Comma-separated field list, `-` prefix for descending, order = priority order. Only fields on the `sortable` allowlist are usable. If a request supplies no `sort` at all, the entity's configured `query.defaultSort` (if any) applies — a client-supplied `sort` always wins outright over that default rather than merging with it.

## Pagination

```
GET /books?limit=20&offset=40
```

The default strategy is flat `limit`/`offset` (0-based) — the same field names the response envelope reports back, so request and response mirror each other. A missing `limit` falls back to `pagination.defaultLimit`; a `limit` above `pagination.maxLimit` is clamped, not rejected.

A 1-indexed page-based alternative is also built in — `page[number]`/`page[size]` — for entities configured to use it (see [Configuration](/integrations/nest/configuration)). It normalizes to the same `limit`/`offset` internally, so the response envelope always reports `limit`/`offset` either way.

### Cursor (keyset) pagination

```
GET /books?limit=20
GET /books?limit=20&cursor=WzE3MTIzNDU2Nzg5LDQyXQ
```

For entities configured with `pagination.strategy: "cursor"`, a page is defined by the row it continues _after_ rather than by a count of rows to skip. Given a matching index (see below) that makes fetching a page `O(limit)` however deep it is, and stable while rows are being inserted and deleted — offset paging can skip or repeat a row when the data shifts underneath it.

The next page's token comes back as **`meta.nextCursor`**, and is `null` on the last page:

```json
{
  "items": [{ "id": 41, "title": "Dune" }],
  "limit": 20,
  "offset": 0,
  "total": 137,
  "meta": { "nextCursor": "WzE3MTIzNDU2Nzg5LDQyXQ" }
}
```

Pass it straight back as `?cursor=…` to get the next page, and keep every other parameter (`sort`, `filter`, `include`, `fields`) identical.

Things to know:

- **A cursor is opaque.** It encodes the previous page's last row projected onto the effective sort. Do not parse it, construct one, or store it as a permanent bookmark — the encoding is an implementation detail and may change. It is _not_ signed and is not a security boundary: everything inside it is a comparison value against a field the client can already filter on, so forging one grants nothing `filter[…]` does not.
- **The sort must end in the id field.** Keyset paging needs a total order, so `sort` (or the entity's `query.defaultSort`) has to end in the entity's primary key: `?sort=-createdAt,id`. A request without one is a 400 naming the field it needs. The sort keys must also be plain scalar columns of the entity — not relation paths, and not JSON columns.
- **Every cursor sort key must be filterable and selectable too,** not just sortable. A cursor turns each sort key into a filter comparison and reads its value off the raw row into `meta.nextCursor`, so a field that is on `allowlists.sortable` but missing from `allowlists.filterable` or `allowlists.selectable` is rejected with a 400 rather than quietly dropped from the sort. If you narrow one of the three allowlists, narrow all three the same way for any column you intend to page by.
- **A bad cursor is a 400,** exactly like a malformed `page[number]`: `KAVO_QUERY_INVALID` with a `cursor` issue. That includes a token from a _different_ sort, which is why changing `sort` means starting from the first page again.
- **`offset` is always `0`** on a cursor page. A keyset page knows what comes after a row, not how many rows precede it; the field stays in the envelope because the envelope's shape is fixed. `total` is unaffected — it still counts the whole match set, and still respects `pagination.count`.
- **You need a matching composite index.** Keyset paging is only `O(limit)` against an index covering the sort tuple **in that exact column order and with those directions** — `(created_at DESC, id ASC)` for `?sort=-createdAt,id`. Kavo never owns your schema, so it cannot create it for you. Without one, every page sorts the whole match set; on MongoDB an unindexed large sort does not merely get slow, it exceeds the 32 MB in-memory sort limit and returns an error.
- **Turn `pagination.count` off.** It defaults to `true`, so an out-of-the-box cursor page is the cheap keyset select _plus_ a `COUNT(*)` over the entire match set — which is `O(n)` and dominates everything the cursor just saved. `total` is the one thing keyset paging cannot make cheap, so pair `strategy: "cursor"` with `count: false` unless you genuinely need the number.

Two things cursor pagination does **not** support:

- **Nullable sort keys.** A cursor cannot resume from a `null`, and which way it fails depends on where your database sorts NULLs. When they sort _first_, a page boundary landing on a null-keyed row returns a 400 naming the column. When they sort _last_ — PostgreSQL's default for `ASC`, sqlite's for `DESC` — the null-keyed rows are **silently omitted from every page**: no error, `meta.nextCursor` goes to `null` as if you had reached the end, and `total` still counts the rows you never saw. Sort only on columns that are never null.
- **`bigint` and decimal columns**, including as the primary key. Their runtime representation disagrees with the column type Kavo derives from your ORM (a JS `bigint`, a `Decimal` object, or a string depending on the ORM), which a page token cannot round-trip. Kavo raises a configuration error naming the column rather than paging incorrectly.

Finally, the **GraphQL and MCP bindings cannot page a cursor-configured entity.** Both expose `limit`/`offset` only, and a keyset page ignores `offset`, so binding one would answer every paged query with the first page. They refuse at bootstrap with a configuration error instead. Page those entities over REST, or give them an entity-scope `pagination.strategy` of `"offset"`/`"page"`.

## Field selection

```
GET /books?fields=id,title
```

Sparse fieldset for the root resource, validated against the `selectable` allowlist. Narrow an included relation the same way: `fields[author]=id,name`.

## Includes

```
GET /books?include=author,reviews.user
```

Comma-separated dot-paths, merged into one tree. Only relations the entity marks `includable` (see [Configuration](/integrations/nest/configuration#relations)) can appear here — an un-includable or misspelled relation is a 400.

## Soft-deleted rows

```
GET /books?withDeleted=true
```

Opts back into seeing soft-deleted rows on a read that would otherwise exclude them. `?onlyDeleted=true` narrows the other way — only soft-deleted rows, for a "trash" view. Both are rejected outright on an entity that isn't soft-deletable, and setting both together is rejected as a conflicting combination, rather than either being silently ignored — see [Getting started's soft delete section](/getting-started#soft-delete).

## The response envelope

A list response (`GET /books`) always has the same shape:

```json
{
  "items": [{ "id": 1, "title": "Dune" }],
  "limit": 20,
  "offset": 0,
  "total": 1,
  "meta": {}
}
```

`total` is `null` (and its `COUNT` query skipped) if `pagination.count` is turned off. The key is always present — the envelope's shape does not change with configuration, only the value does.

`meta` is an open bag for anything the API wants to say about the list that isn't a row: a facet count, a "results are approximate" flag, the next cursor. It carries `nextCursor` under [cursor pagination](#cursor-keyset-pagination), and is otherwise `{}` unless the entity's `findMany` handler puts something there — see [custom list metadata](/integrations/nest/configuration#custom-list-metadata) for how. `nextCursor` is the one key core writes itself; nothing in the bag is projected, filtered, or renamed on the way out, so apart from that key, what the handler returns is what the client receives.

## Errors

Every error response is an [RFC 9457 problem-details](https://www.rfc-editor.org/rfc/rfc9457) document, `Content-Type: application/problem+json`:

```json
{
  "type": "https://kavo.dev/errors/kavo-not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Book with id 999 was not found.",
  "instance": "urn:kavo:request:a1b2c3d4",
  "code": "KAVO_NOT_FOUND"
}
```

A query-validation failure additionally carries an `errors[]` array, so a client can fix every problem with its request in one round trip instead of one at a time:

```json
{
  "type": "https://kavo.dev/errors/kavo-query-invalid",
  "title": "Bad Request",
  "status": 400,
  "detail": "The request query is invalid.",
  "code": "KAVO_QUERY_INVALID",
  "errors": [{ "code": "KAVO_QUERY_INVALID_FIELD", "detail": "'nickname' is not a filterable field." }]
}
```

The most common codes:

| Code                   | HTTP | Fires when                                              |
| ---------------------- | ---- | ------------------------------------------------------- |
| `KAVO_QUERY_INVALID`   | 400  | Any filter/sort/select/pagination violation (aggregate) |
| `KAVO_NOT_FOUND`       | 404  | Target row missing on a get/update/patch/delete         |
| `KAVO_CONFLICT`        | 409  | A unique or foreign-key violation                       |
| `KAVO_ALREADY_DELETED` | 409  | Soft-deleting a row that's already deleted              |
| `KAVO_NOT_DELETED`     | 409  | Restoring or purging a row that isn't deleted           |

Driver-level detail (raw SQL error text, stack info) never leaks into `detail` unless `errors.exposeInternals` is turned on — keep it off in production. See [Error handling](/internals/architecture/06-error-handling) for the full exception hierarchy and code catalog.
