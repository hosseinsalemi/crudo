# 09 — TypeORM Adapter (Phases 9–10)

`@crudo/typeorm` implements `RepositoryAdapter` (= `EntityReader` +
`EntityWriter`) over a TypeORM `DataSource` and feeds core's metadata
seam. Skeleton scope: CRUD with hard delete, filtering (incl. `NOT` and
relation paths), sorting, pagination, optional counting. `typeorm` is a
peerDependency; `@crudo/core` never imports it.

## 1. The metadata seam

`buildEntityMetadata(dataSource, Entity)` translates TypeORM metadata
into the ORM-independent `EntityMetadata`: id field (exactly one primary
column — composite keys rejected at bootstrap), scalar columns with
`FieldKind` + nullability + generated flags (`isGenerated`, create/
update/delete-date, version columns), enum members, and relation
descriptors (`includable: false` always — ORM metadata supplies shape,
never permission). `createTypeOrmInfrastructure(dataSource)` packages
metadata + adapters, cached per entity; `createTypeOrmCrudo` is the
zero-config sugar.

## 2. Query translation (Filter AST → QueryBuilder)

`FilterTranslator`: groups become `Brackets`/`NotBrackets` — precedence
is explicit parentheses, never operator-order luck; parameters are
numbered globally per query. Notable translations: `EQ null` → `IS NULL`;
empty `IN` → `1 = 0` (empty `NOT IN` → `1 = 1`) since SQL `IN ()` is
invalid; `LIKE` carries `ESCAPE '\'` (the grammar's literal-escape);
`ILIKE` → `LOWER(col) LIKE LOWER(:v)` — portable across every driver, one
spelling instead of a per-driver fork.

**Relation-path conditions** (`author.name`) add one **non-selecting**
left join per path segment with deterministic aliases (`Book__author`),
reused across conditions. They restrict root rows; _loading_ a relation is
what `include=` does (doc 12), and because include joins use the same
alias scheme and register themselves with the translator, a filter on an
included path reuses that one selecting join. Relation paths are only
filterable when explicitly allowlisted.

## 3. Repository API vs. QueryBuilder API

- **Reads → QueryBuilder**: the only surface that can express the
  translated AST, joins, ORDER BY on joined paths, and skip/take.
- **Writes → Repository**: entity hydration, column defaults, and
  cascades matter; no dynamic SQL is needed. `update` and `patch` share
  one load-merge-save primitive — the _shape_ of the payload differs at
  the DTO layer (full body vs. sparse), not the persistence mechanics.

**Soft delete** (Phase 14, doc 11) rides on both halves.
`buildEntityMetadata` reports `@DeleteDateColumn` as
`EntityMetadata.softDeleteField`; reads scope themselves to live rows —
`.withDeleted()` for a declared delete column, an explicit
`<alias>.<field> IS NULL` for a marker column named through config — and
`delete`/`restore`/`purge` branch on `context.config.softDelete`,
reaching for TypeORM's own `softDelete`/`restore` only when the field is
the declared one.
Missing rows raise `NotFoundException` (load returns `null`;
`delete` checks `affected === 0`).

## 4. Pagination & count strategy

`skip`/`take` from the normalized `limit`/`offset`. `count()` is a
dedicated query built from the same filter (sorting stripped) — never
`getManyAndCount`: the engine only calls `count` when
`pagination.count` is true, so `total: null` costs zero extra queries.

## 5. Error-mapping table

`mapDriverError` — the original error always travels as `cause`:

| Driver condition (PG SQLSTATE / MySQL errno / SQLite code)                   | Exception                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------ |
| unique violation (`23505` / 1062 / `SQLITE_CONSTRAINT_UNIQUE`·`_PRIMARYKEY`) | `ConflictException`                        |
| FK violation (`23503` / 1451·1452 / `SQLITE_CONSTRAINT_FOREIGNKEY`)          | `ConflictException`                        |
| serialization/deadlock (`40001`·`40P01` / 1213 / `SQLITE_BUSY`)              | `TransactionException` (`retryable: true`) |
| anything else                                                                | `PersistenceException` with `cause`        |

## 6. Attachment points for later phases

- **Transactions (13):** every method already receives `CrudContext`;
  the `QueryRunner` will ride on `context.transaction.handle`, and reads/
  writes switch to the runner's manager when present.
- **Soft delete (15):** the strategy branch lives in `delete` (currently
  hard) and the `restore`/`purge` stubs; query methods add the
  `deletedAt IS NULL` predicate driven by `query.withDeleted`.
- **Includes (16):** `buildQuery` grows `leftJoinAndSelect`/batch loading
  from the validated `IncludeTree`; alias management is already
  deterministic.

## 7. Performance posture

Filters and sorts translate to plain indexed-column predicates —
index-aware by construction (no function-wrapping except the documented
`ILIKE` lowering, which callers can avoid with `like`). No N+1 in
skeleton scope (no relation loading); no unbounded queries (`maxLimit`
clamps upstream). Integration tests run the real engine→adapter stack on
in-memory SQLite (`tests/adapter.spec.ts`), per-package testing as
specified.
