# 05 — Query Model, Filter Engine & Query String Grammar (Phase 5)

This is the standalone grammar reference — it is written to serve as
end-user documentation verbatim. The implementation lives in
`core/src/query/` (`DefaultFilterParser`, `QueryNormalizer`, the
pagination strategies); adapters only ever see the validated, normalized
result.

## 1. Operators — AST names and wire tokens (single source of truth)

| AST operator  | Wire token   | Example                                            |
| ------------- | ------------ | -------------------------------------------------- |
| `EQ`          | `eq`         | `filter[status][eq]=active`                        |
| `NE`          | `ne`         | `filter[status][ne]=banned`                        |
| `GT` / `GTE`  | `gt` / `gte` | `filter[age][gte]=18`                              |
| `LT` / `LTE`  | `lt` / `lte` | `filter[age][lt]=65`                               |
| `IN`          | `in`         | `filter[status][in]=active,pending`                |
| `NOT_IN`      | `notIn`      | `filter[role][notIn]=bot,test`                     |
| `LIKE`        | `like`       | `filter[name][like]=%25john%25`                    |
| `ILIKE`       | `ilike`      | `filter[name][ilike]=%25john%25`                   |
| `BETWEEN`     | `between`    | `filter[createdAt][between]=2026-01-01,2026-06-01` |
| `IS_NULL`     | `isNull`     | `filter[deletedAt][isNull]=true`                   |
| `IS_NOT_NULL` | `isNotNull`  | `filter[deletedAt][isNotNull]=true`                |

Wire tokens are camelCase and **exact-case matched** — one spelling, no
aliases (`GTE`/`Gte` are 400s). Logical operators: `AND`, `OR`, `NOT`
(wire: `and`, `or`, `not`). Core ships exactly this set; an operator
registry mapping tokens to AST factories is a natural extension point but
is deliberately not built in v6.

## 2. Reference example

```
GET /users
  ?filter[age][gte]=18
  &filter[status][in]=active,pending
  &filter[name][like]=%25john%25
  &filter[or][0][role][eq]=admin
  &filter[or][1][status][eq]=banned
  &sort=-createdAt,name
  &limit=20&offset=20
  &fields=id,name,email
```

resolves to

```
AND[ age GTE 18, status IN [active, pending], name LIKE "%john%",
     OR[ role EQ "admin", status EQ "banned" ] ]
sort:       [{ createdAt desc }, { name asc }]
pagination: { limit: 20, offset: 20 }
fields:     root: [id, name, email]
```

## 3. Grammar rules

- **Filters:** `filter[field][operator]=value`. Multiple `filter[...]`
  params AND together implicitly. Multiple operators on one field also
  AND (`filter[age][gte]=18&filter[age][lt]=65`).
- **Multi-value operators** (`in`, `notIn`): comma-separated by default;
  the repeated-key form `filter[status][in][]=a&filter[status][in][]=b`
  is also accepted.
- **`between`:** exactly two comma-separated bounds.
- **`isNull` / `isNotNull`:** boolean-valued. `false` flips to the
  complementary operator (`isNull=false` ≡ `isNotNull=true`), so both
  spellings mean what they read as.
- **`like` / `ilike`:** never auto-wrap wildcards — callers pass `%`
  explicitly. Literal `%` and `_` are escaped with a backslash (`\%`,
  `\_`); the adapter emits the matching `ESCAPE '\'` clause. `ilike` is
  translated portably (`LOWER(col) LIKE LOWER(:v)`), identical on every
  driver. Both operators apply to string columns only.
- **Relation-path filtering:** dot notation
  (`filter[profile.city][eq]=Helsinki`), permitted only for paths on the
  filterable allowlist. Relation-path filters **restrict root rows** (a
  non-selecting join); they never load or filter the included collection.
- **Nested boolean trees:** `filter` also accepts one JSON-encoded value
  — `?filter={"or":[{"name":{"eq":"admin"}},{"not":{"status":{"eq":"x"}}}]}` —
  parsed into the same AST. Bracket notation is sugar for the common flat
  cases; JSON is the full-power escape hatch. **Both produce the
  identical AST** (asserted in `filter-parser.spec.ts`); when both
  appear, they AND together.
- **Sort:** `sort=-createdAt,name` — comma-separated, `-` prefix =
  descending, list order is priority order. Sortable-allowlist enforced.
- **Pagination:** pluggable `PaginationStrategy`. Default `offset`: flat
  `limit`/`offset` (0-based) — the same field names the response envelope
  reports, so request and response mirror each other. Built-in
  alternative `page`: `page[number]`/`page[size]` (1-indexed), normalized
  internally to `limit`/`offset`. Missing `limit` → `defaultLimit`;
  `limit` above `maxLimit` → clamped; malformed or negative → 400.
- **Field selection:** `fields=id,name,email` — sparse fieldset for the
  root resource, validated against the selectable allowlist.
  `fields[<relation path>]=id,title` narrows an included node, validated
  against the _target_ entity's allowlist (doc 12).
- **Soft delete:** `withDeleted=true` includes soft-deleted rows, which
  are otherwise excluded from every read (Phase 14, doc 11). On an entity
  that is not soft-deletable it is rejected with
  `CRUDO_QUERY_UNSUPPORTED_PARAM`, not ignored; a non-boolean value is a
  field-level 400.
- **Includes:** `include=posts.comments,profile` — comma-separated
  dot-paths, merged into one validated tree (Phase 15, doc 12). A
  relation that is not on the entity's inclusion allowlist is a 400, never
  a silent omission.

## 4. Security & robustness

- **Allowlists:** every entity resolves filterable/sortable/selectable
  lists at bootstrap — explicitly configured, or defaulting to the
  entity's **own scalar columns** (relation paths are never allowlisted
  implicitly). Anything outside a list → 400
  (`CRUDO_QUERY_INVALID_FIELD`), never a silent drop. Programmatic
  callers (`findMany({ filter })`) pass through the **same** allowlist
  and limit checks — typed input skips coercion, not security.
- **Limits** (configurable per scope, Phase 8): `query.maxFilterDepth`
  (default 3) on the built AST, `query.maxInValues` (default 100) on
  `in`/`notIn` arrays, `pagination.maxLimit` (default 100) on page size.
- **Type coercion:** raw wire strings coerce against column metadata
  before becoming AST values — number, boolean (`true`/`false`/`1`/`0`),
  date (ISO 8601), enum (member match), `null` for nullable columns.
  Failures are field-level 400 issues, never a silent `NaN` or
  `Invalid Date`. Coercion consults the **root** entity's column metadata
  only: a relation-path value (`filter[profile.city][eq]=…`) has no entry
  in that map and passes through as a string. Phase 15 wired the target
  entity's config into include resolution and fieldset validation, but not
  into filter-value coercion.
- **One exception, all issues:** every violation across filter, sort,
  fields, and pagination is collected into a single
  `QueryValidationException`, so a client fixes its request in one round
  trip (`errors[]` in the problem-details body).

## 5. Normalization pipeline

```
raw query string (flat bracket keys)
  → DefaultFilterParser   (allowlist + coercion + limits → Filter AST)
  → sort / fields parsing (allowlists)
  → PaginationStrategy    (defaultLimit / maxLimit / 400s)
  → NormalizedQueryContext  { filter, sort, pagination, fields,
                              include: {}, withDeleted: false, count }
```

`QueryNormalizer.normalizeWire` runs the whole pipeline for HTTP input
(the `WireQuery` marker from the framework layer);
`QueryNormalizer.normalizeInput` runs the same validation minus coercion
for programmatic `QueryContext` input. Adapters consume the normalized
form and never re-validate.
