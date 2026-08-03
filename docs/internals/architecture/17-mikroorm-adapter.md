# 17 — MikroORM Adapter

`@kavo/mikroorm` implements `RepositoryAdapter` (= `EntityReader` +
`EntityWriter`) over a MikroORM `EntityManager` and feeds core's metadata
seam from MikroORM's own `MetadataStorage`. Core scope matches
`@kavo/typeorm` (doc 09): CRUD with hard delete, filtering (incl. `NOT`
and relation paths), sorting, pagination, optional counting, soft
delete/restore/purge (doc 11), and relation loading (doc 12).
`@mikro-orm/core` is a peerDependency; `@kavo/core` never imports it.

Where this adapter sits between the other two SQL adapters is worth stating
up front, because nearly every design choice below follows from it:
MikroORM has **TypeORM's entity model** (real decorated runtime classes
carrying their own metadata) and **Prisma's query surface** (a declarative
`FilterQuery` object that nests relation paths natively, not a SQL string
builder). So the metadata seam mirrors `@kavo/typeorm` and the translation
seam mirrors `@kavo/prisma`.

## 1. Entities are their own identity — no marker classes

A MikroORM `@Entity()` class is a real runtime class, so this adapter gets
an entity's `ClassRef` identity for free exactly as `@kavo/typeorm` does.
There is no counterpart to ADR-0017's marker classes (which exist because
Prisma erases its models at compile time) and none to ADR-0018 (which
records that a Mongoose model _is_ the identity): the class the caller
passes to `createCrud` is the class MikroORM registered, matched by name
through `orm.getMetadata()`.

`createInfrastructure(orm)` therefore takes nothing but the ORM instance —
no `entities` list, no datamodel — and neither does `createMikroOrmKavo`.
An entity MikroORM never registered is refused at bootstrap with
`KAVO_CONFIGURATION_ERROR` rather than failing per request.

### Metadata mapping

| Core `EntityMetadata` | MikroORM source                                               |
| --------------------- | ------------------------------------------------------------- |
| `name`                | `meta.className`                                              |
| `idField`             | `meta.primaryKeys[0]` — more than one is refused              |
| `fields`              | properties with `kind: "scalar"` or `"embedded"`              |
| `relations`           | properties with any other `kind` (`m:1`, `1:1`, `1:m`, `m:n`) |
| `softDeleteField`     | always `null` — see §5                                        |

Three details are less obvious than the table suggests:

**Field kind comes from `runtimeType`, not the column type.** MikroORM
normalizes `runtimeType` to the JavaScript type a property actually holds,
which is what core must coerce toward. A `bigint` or `decimal` column
surfaces as `string` there and is reported as `string` — reading `number`
off the column type instead would corrupt values past 2⁵³. The declared
`type` is consulted only as a fallback, for the custom types whose
`runtimeType` is `"any"` and therefore narrows nothing (`JsonType`).

**Generated is a union of four independent flags.** MikroORM has no single
"the caller cannot write this" marker, so `generated` is true for an
auto-increment or database-generated column, a property with an
`onCreate`/`onUpdate` hook (the equivalent of TypeORM's
`@CreateDateColumn`/`@UpdateDateColumn`), an optimistic-lock
`version: true`, and `persist: false`.

**Embeddable child properties are dropped.** An `@Embedded()` property
contributes both the object-valued parent (`kind: "embedded"`) and one
child per inner column, carrying an `embedded: [parent, child]`
back-reference and a name that is an implementation detail (`address~city`
when stored as an object, `billing_city` when inlined). Only the parent is
addressable on the wire, so the children are filtered out rather than
leaked into derived DTOs and allowlists. The parent is reported as `json`.

## 2. Query translation (Filter AST → MikroORM `FilterQuery`)

The translator is a pure function over core's AST — no query-builder state,
no join aliases, no parameter numbering — because MikroORM nests relation
paths natively and adds the join itself. A dotted field simply nests one
level deeper, the same shape `@kavo/prisma`'s translator produces.

| AST operator  | MikroORM                                     |
| ------------- | -------------------------------------------- |
| `EQ` / `NE`   | `$eq` / `$ne` (`$ne: null` is `IS NOT NULL`) |
| `GT`…`LTE`    | `$gt`, `$gte`, `$lt`, `$lte`                 |
| `IN`/`NOT_IN` | `$in` / `$nin`                               |
| `LIKE`        | `$like`                                      |
| `ILIKE`       | `$ilike`, or `$like` — see below             |
| `BETWEEN`     | `{ $gte, $lte }`                             |
| `IS_NULL`     | `$eq: null`                                  |
| `IS_NOT_NULL` | `$ne: null`                                  |
| `AND`/`OR`    | `$and` / `$or`                               |
| `NOT`         | `$not` over the group's single child         |

Every comparison is wrapped in an explicit operator (`{ $eq: v }`, never
the bare `{ field: v }` shorthand). Core coerces filter values to scalars
upstream, so this is defence in depth — but an object arriving through the
shorthand would be spliced in as _operators_, and the boundary's job is to
be safe on its own terms.

Falling through the operator switch is impossible: the union is proven
total at build time with `assertNever`, and a forged AST raises
`PersistenceException` (500) rather than silently dropping the predicate
and widening the result set.

**The degenerate empty groups need care.** MikroORM rejects an empty
`$and`/`$or` outright, and `$not: {}` negates _no condition at all_, which
it renders as match-everything — the exact opposite of what an empty `OR`
or `NOT` means. An empty `$in` on the primary key is the one spelling
MikroORM turns into a genuine contradiction on every driver, so that is how
"matches nothing" is written. (Core's parser enforces group arity, so these
only guard hand-built ASTs passed programmatically.)

**`ILIKE` is a declared capability, not a detected one.** `$ilike` works on
PostgreSQL and nowhere else — SQLite, MySQL, and MongoDB receive the token
verbatim and fail with a syntax error. MikroORM's `Platform` exposes
nothing to detect this from, so it is
`MikroOrmInfrastructureOptions.caseInsensitiveFilters`, the same posture
`@kavo/prisma` takes for `mode: "insensitive"`.

It defaults to **`false`**, where `@kavo/prisma`'s equivalent defaults to
`true`. The defaults differ because the failure modes are not symmetric
here: declaring it off on PostgreSQL costs case-insensitivity, while
leaving it on anywhere else makes every `ILIKE` query throw. On SQLite the
default is not even a loss — SQLite's own `LIKE` is already ASCII
case-insensitive.

## 3. Includes: `populate`, and no join/batch split

Core resolves `IncludeNode.strategy` to `join` or `batch` (doc 12), and
this adapter **ignores it**, exactly as `@kavo/prisma` does.

`@kavo/typeorm` translates the split because it drives a raw SQL query
builder, where a to-many `JOIN` multiplies root rows and separate batched
queries are how that trap is avoided. MikroORM resolves `populate` with its
own queries and applies `limit`/`offset` to the root regardless of load
strategy, so a to-many include never disturbs pagination here — there is
nothing left for the distinction to control. MikroORM's own `strategy`
option is per-query rather than per-relation anyway, so it could not
express a mixed include tree even if it were wanted.

The include tree is flattened to MikroORM's dotted `populate` paths
(`["articles", "articles.notes"]`). Soft-deleted related rows are excluded
from every include, to-one and to-many alike, through a nested
`populateWhere` mirroring the tree's shape — the same rule the other
adapters apply, and a root `withDeleted` never widens an included relation.
When no included relation is soft-deletable, `populateWhere` is omitted
entirely so MikroORM's own default (`PopulateHint.ALL`) stands.

## 4. The EntityManager is forked per operation

MikroORM is a Unit-of-Work ORM: an `EntityManager` owns an identity map
caching every entity it has loaded. Holding one across requests would serve
stale rows and leak one caller's entities into another's, so **every
adapter method starts from `orm.em.fork()`** — the same scope a
request-scoped `RequestContext` gives a hand-written MikroORM application.
That is also why `createInfrastructure` takes the `MikroORM` instance
rather than an `EntityManager`: it needs something to fork _from_.

Rows are converted to plain objects at the boundary with
`wrap(entity).toObject()`. This is required, not cosmetic: a to-many
relation is a `Collection<T>`, not an array, and core's `DefaultSerializer`
branches on `Array.isArray` to decide whether an included relation is a
list or a single row — a `Collection` would fall down the single-row path
and serialize its internal fields. `@kavo/mongoose` converts documents at
the same seam for the same reason.

Two consequences of `toObject()` are behavior, not implementation detail:
an unpopulated relation collapses to its primary key (harmless — core emits
a relation key only for an included node), and **MikroORM's own property
options apply before core sees the row**, so a
`@Property({ hidden: true })` is dropped and a custom `serializer` runs
first. The ORM's declaration wins there, even over a Kavo DTO that names
the property.

Writes go through the Unit of Work — `em.create` / `wrap(entity).assign`
then `flush` — so lifecycle hooks, `onUpdate` properties, and relation
diffing behave as they would in a hand-written application. `update` and
`patch` share one load-merge-flush primitive; the _shape_ of the payload
differs because the DTO layer differs, not the persistence mechanics. The
row is loaded first regardless, to turn a missing id into a 404, so the
merge costs no extra query. The soft-delete marker writes and the hard
deletes use `nativeUpdate`/`nativeDelete`, whose affected-row count is what
turns a repeat delete into a 404 rather than a silent success.

Core's deserializer narrows a relation value to `{ id }` (ADR-0014), while
MikroORM associates by the bare primary-key value and would read a nested
`{ id }` as a request to _create_ a new entity — so relation values are
unwrapped to the bare key before reaching `create`/`assign`.

## 5. Soft delete is always configured, never detected

`softDeleteField` is always `null` on this adapter's metadata. MikroORM
declares no delete-date column: its soft-delete pattern is a user-defined
`@Filter`, which is a query concern rather than a column declaration, so
there is nothing for the metadata seam to detect. Soft delete therefore
needs an explicit `softDelete.field` in Kavo config — the same position
`@kavo/prisma` and `@kavo/mongoose` are in, and unlike `@kavo/typeorm`,
whose `@DeleteDateColumn` makes zero-config soft delete work.

There is consequently one marker shape to handle rather than TypeORM's two:
the marker is always an ordinary property, so the `IS NULL` /
`IS NOT NULL` predicate is always spelled out, for all three scopes
(default, `withDeleted`, `onlyDeleted`).

**Do not also enable a MikroORM `@Filter` for soft delete.** Kavo owns the
scoping through `softDelete.field`; a default-on MikroORM filter would AND
a second predicate onto every query and quietly defeat `withDeleted`. Use
one or the other.

## 6. Error-mapping table

| MikroORM condition                               | Exception                         |
| ------------------------------------------------ | --------------------------------- |
| `UniqueConstraintViolationException`             | `ConflictException` (409)         |
| `ForeignKeyConstraintViolationException`         | `ConflictException` (409)         |
| `DeadlockException` / `LockWaitTimeoutException` | `TransactionException`, retryable |
| anything else                                    | `PersistenceException` (500)      |

The same four rows `@kavo/typeorm`'s table has (doc 06), reached
differently. MikroORM normalizes each driver's native error into its own
exception hierarchy before it surfaces, so this adapter matches on those
classes rather than recognizing Postgres SQLSTATEs, MySQL errnos, and
SQLite extended codes itself. Every driver MikroORM supports is covered by
that normalization; anything it does not recognize falls through to
`PersistenceException`, and the original error always travels as `cause`.

Note the line the table draws: only unique and foreign-key violations are
conflicts. A `NotNullConstraintViolationException` or
`CheckConstraintViolationException` is not the caller's to resolve, so it
stays a 500 — the same boundary `@kavo/typeorm` draws when its SQLite
message sniff declines to match a `NOT NULL` failure.

A soft-deleted row still occupies its unique indexes, so re-creating "the
same" row after a soft delete raises a 409 — the honest answer, since the
value _is_ taken. Kavo never rewrites indexes; the fix is a partial unique
index scoped to live rows.

## 7. Adapter-specific caveats

**`LIKE` escapes are driver-dependent.** MikroORM offers no way to attach
an `ESCAPE` clause to a `LIKE`, so the query grammar's `\` escape for a
literal `%`/`_` (doc 05) is honored only by drivers that default to
backslash — PostgreSQL and MySQL do; SQLite has no default escape
character, so `filter[name][like]=100\%` matches the literal text `100\`
followed by anything rather than the string `100%`. `@kavo/typeorm` emits
`ESCAPE '\'` explicitly and does not have this gap.

**The soft-delete marker is writable.** Because nothing declares it, the
marker is an ordinary property: a plain `PATCH` of it will soft-delete a
row, bypassing `deleteOne`'s already-deleted check. It cannot _revive_ one
— writes are scoped to the live set, so a soft-deleted row 404s on
`PUT`/`PATCH`. This is the shared hole `@kavo/prisma` and `@kavo/mongoose`
have; the fix (excluding the resolved `softDelete.field` from the writable
projection) belongs in core. Until then, register an explicit
`update`/`patch` DTO that omits the marker whenever `purgeOne` is enabled.

**Composite primary keys are refused** at bootstrap, matching every other
adapter — single-identifier entities are a v6 scope decision, not a
MikroORM limitation.

**No transactions.** `TransactionManager` is unimplemented here, as it is
across every Kavo adapter today — see the `@remarks` on that interface in
`@kavo/core`. This is parity with `@kavo/typeorm`, which also never reads
`context.transaction`, not a gap specific to this adapter.

**`@mikro-orm/core` v6 only.** The peer range is `^6.0.0`. MikroORM v7
removed decorators entirely in favour of `defineEntity`/`EntitySchema`,
which changes how an entity's `ClassRef` identity is obtained — the premise
§1 rests on — so v7 is not claimed until it is actually tested.

## 8. Performance posture

Counting is a dedicated `em.count` issued only when `query.count` is true,
so `total: null` costs zero queries — never fetch-then-length. Pagination
is `limit`/`offset` on the root, applied by MikroORM independently of
`populate`, so relation loading never multiplies the rows pagination
counts. Metadata derivation and adapter construction are cached per entity
at bootstrap, not repeated per request. The per-operation `em.fork()` is
cheap — it allocates a manager and an empty identity map, it does not touch
the connection pool.
