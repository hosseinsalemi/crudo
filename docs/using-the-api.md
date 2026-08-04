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

`meta` is an open bag for anything the API wants to say about the list that isn't a row: a facet count, a "results are approximate" flag, a cursor. It is `{}` unless the entity's `findMany` handler puts something there — see [custom list metadata](/integrations/nest/configuration#custom-list-metadata) for how. Kavo never writes to it itself, and nothing in it is projected, filtered, or renamed on the way out: what the handler returns is what the client receives.

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
