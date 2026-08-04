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
  "total": 1
}
```

`total` is omitted (and its `COUNT` query skipped) if `pagination.count` is turned off.

## ETags and conditional requests

Every single-item response — `POST /books`, `GET /books/1`, `PUT`, `PATCH`, and `PATCH /books/1/restore` — carries a strong `ETag`:

```
ETag: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
```

It is a hash of the exact representation being returned, so it changes whenever any field in the response does. List responses (`GET /books`) do not carry one.

### `If-None-Match` — skip a body you already have

```
GET /books/1
If-None-Match: "9f86d0…"
```

If your copy is still current you get `304 Not Modified` with an empty body and the same `ETag`. If it isn't, you get the ordinary `200` and a fresh tag. `*` matches any existing representation.

### `If-Match` — don't overwrite a version you never saw

```
PATCH /books/1
If-Match: "9f86d0…"
```

Supported on every route that targets one book: `PUT /books/1`, `PATCH /books/1`, `DELETE /books/1`, and the soft-delete routes `PATCH /books/1/restore` and `DELETE /books/1/purge`. If the book's current tag is one you named, the write goes ahead and the response carries the new tag. If it isn't — somebody else changed the book since you read it — the write is refused with `412 Precondition Failed` and a `KAVO_PRECONDITION_FAILED` problem document naming the current tag, and **nothing is written**. `*` matches any existing representation, so `If-Match: *` means "only if it still exists".

For restore and purge, the tag to send is the one from `GET /books/1?withDeleted=true` — a soft-deleted book is what those routes act on, and an ordinary `GET /books/1` will not show it to you.

If the book doesn't exist at all, or is in a state the route refuses, you get that route's own error rather than a `412`: `404` for a book that isn't there, `409 KAVO_ALREADY_DELETED` for `DELETE` on one that is already soft-deleted. Sending a conditional header never changes which error you get, only whether the write happens.

### `If-Match` where Kavo can't check it

Kavo refuses rather than quietly proceeds. A `412 KAVO_PRECONDITION_UNSUPPORTED` means the header was understood and the write did **not** happen, but the guard could not be evaluated at all — so retrying it unchanged will not help. Three ways to see it:

- **On a route that doesn't target one row** — `POST /books`, and any custom operation you add. Kavo knows what row `PATCH /books/1` is about; it cannot know what a custom `POST /books/1/publish` is about.
- **When [`caching.etag`](/integrations/nest/configuration#caching) is off** for that route, at any scope. No tags are issued, so there is nothing to compare — and answering `200` would tell you a guard was applied when none was.
- **When `findOne` is disabled** on the entity. The check compares against the representation `GET /books/1` would return; with no such route there is none.

`If-Match` on a `GET` is the one case Kavo ignores instead of refusing: a read cannot overwrite anything, and `If-None-Match` above is the read-side conditional.

**A hand-written or `@Override`'d route enforces nothing by itself.** The check runs inside Kavo's engine, so a controller method you wrote replaces it along with everything else — it receives the `If-Match` tokens as its last parameter and must pass them on (`this.base.updateOne(id, data, { preconditions })`) for the guard to apply. See [`caching`](/integrations/nest/configuration#caching).

### Two things to know

**The `If-Match` check is not atomic.** Kavo reads the row, compares the tag, and then writes. There is a real window between the check and the write in which another writer can slip in — so this narrows the last-write-wins race, it does not eliminate it. It is not a database-level compare-and-swap, and Kavo does not claim to be one. If you need that guarantee, enforce it in your own transaction.

**An `If-Match` token has to come from an unnarrowed read.** An ETag identifies one _representation_, so `GET /books/1?fields=title` produces a different tag from `GET /books/1`. Preconditions are evaluated against the full default representation, so a tag taken from a `fields=`- or `include=`-narrowed read will 412. Use the tag from a plain `GET /books/1`. The tag on a write response works too — it is the tag of the body you just got back — but only while that body is the same representation a plain `GET` returns, which stops being true once a relation is configured `defaultInclude`: a write resolves no query, so write responses never carry relations. On such an entity, take the token from a `GET`.

Both halves are one setting, [`caching.etag`](/integrations/nest/configuration#caching) (on by default). Turning it off at any scope stops the tags being generated _and_ stops the conditional headers being honored.

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
