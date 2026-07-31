# 14 — Prisma Adapter

`@kavo/prisma` implements `RepositoryAdapter` (= `EntityReader` +
`EntityWriter`) over a Prisma Client model delegate and feeds core's
metadata seam from Prisma's DMMF. Core scope matches `@kavo/typeorm`
(doc 09): CRUD with hard delete, filtering (incl. `NOT` and relation
paths), sorting, pagination, optional counting, soft delete/restore/purge
(doc 11), and relation loading (doc 12). `@prisma/client` is a
peerDependency; `@kavo/core` never imports it, and `@kavo/prisma`'s own
`src` imports no Prisma type either — see §1.

## 1. Marker classes and the metadata seam (ADR-0017)

Prisma generates no runtime class for a model — its output is TypeScript
types, erased at compile time — so this adapter cannot get an entity's
`ClassRef` identity for free the way `@kavo/typeorm` does from
`@Entity()` classes. Callers declare one empty **marker class** per
model, matched to Prisma's DMMF by name (`class Author {}` ↔
`model Author { … }`), and register every marker class with
`createPrismaInfrastructure`'s `entities` list — the registry a relation's
target model name resolves back to its class through, since Prisma
supplies no such registry either. Full rationale in ADR-0017.

`buildEntityMetadata(datamodel, Entity, entities)` reads Prisma's DMMF
structurally (a locally-defined subset type, not an import from
`@prisma/client` or `@prisma/generator-helper` — this keeps
`@kavo/prisma`'s own build free of a `prisma generate` dependency): id
field (exactly one `isId` field — composite keys rejected at bootstrap,
same posture as `@kavo/typeorm`), scalar fields with `FieldKind` +
nullability + generated flags, enum members, and relation descriptors
(`includable: false` always). `EntityMetadata.softDeleteField` is always
`null` — Prisma declares no delete-marker column the way
`@DeleteDateColumn` does, so soft delete is always explicit
`softDelete.field` configuration for this adapter, never auto-detected.

## 2. Query translation (Filter AST → Prisma `where`)

`translateFilter`: `AND`/`OR`/`NOT` groups map directly onto Prisma's own
`AND`/`OR`/`NOT` combinators. Unlike `@kavo/typeorm`'s translator this
needs no query-builder state — no join aliases, no parameter numbering —
because Prisma's `where` already nests relation paths natively
(`{ author: { name: { equals: "Ada" } } }`), so a relation-path condition
(`author.name`) just nests the same translation one level deeper instead
of adding a join. `LIKE`/`ILIKE` map onto `startsWith`/`endsWith`/
`contains`/`equals` by wildcard position, since Prisma has no raw pattern
operator.

**`ILIKE` and connector support.** Prisma's case-insensitive filter
(`mode: "insensitive"`) is Postgres/MongoDB-only; MySQL, SQLite, and SQL
Server reject the argument. There is no reliable way to detect the
connector from the DMMF at runtime, so `caseInsensitiveFilters` is an
explicit, caller-declared setting on `PrismaInfrastructureOptions`
(default `true`) rather than a guess. Set `false` for `ILIKE` to degrade
to the same translation as `LIKE` on an unsupported connector — a no-op
on SQLite in particular, since SQLite's own `LIKE` is already ASCII
case-insensitive.

## 3. Includes: no join/batch split

`@kavo/typeorm` translates `IncludeNode.strategy` (`join` vs. `batch`)
because it drives a raw SQL query builder, where a to-many `JOIN`
multiplies root rows and a separate batched query is how core's
pagination-correctness rule (doc 12) avoids that. Prisma's `include` has
no such failure mode: it always resolves relations as its own internally
batched queries, to-one or to-many alike, never a row-multiplying join —
so a to-many include never disturbs root pagination regardless of which
strategy core resolved. `PrismaRepositoryAdapter` therefore _ignores_
`IncludeNode.strategy` entirely and maps every node the same way: a
nested `include` entry, with a `where` excluding soft-deleted rows when
the target is soft-deletable (Prisma accepts `where` inside `include` for
to-one and to-many edges alike). A root `withDeleted` is the root's own
opt-in only, same rule as `@kavo/typeorm`.

## 4. Pagination & count strategy

`skip`/`take` from the normalized `limit`/`offset`, same as
`@kavo/typeorm`. `count()` is a dedicated `delegate.count()` call built
from the same filter — never fetch-then-length: the engine only calls
`count` when `pagination.count` is true, so `total: null` costs zero
extra queries.

## 5. Error-mapping table

`mapDriverError` reads `PrismaClientKnownRequestError.code` — Prisma
normalizes every connector's errors into its own driver-agnostic
`P####` catalog, so unlike `@kavo/typeorm`'s table this one needs no
per-database code lists. The original error always travels as `cause`:

| Prisma code                   | Exception                                  |
| ----------------------------- | ------------------------------------------ |
| `P2002` unique constraint     | `ConflictException`                        |
| `P2003` / `P2014` FK/relation | `ConflictException`                        |
| `P2025` record not found      | `NotFoundException`                        |
| `P2034` transaction conflict  | `TransactionException` (`retryable: true`) |
| anything else                 | `PersistenceException` with `cause`        |

## 6. Attachment points for later work

- **Transactions:** same unbuilt seam as `@kavo/typeorm` (doc 09 §6) —
  `TransactionManager` has no consumer in this build.
- **Composite primary keys:** out of scope, same as `@kavo/typeorm`.
- **Implicit many-to-many relations:** associate-by-id (ADR-0014) writes a
  scalar foreign-key field, which an implicit Prisma m:n relation has none
  of (Prisma manages the join table itself). See the package README for
  the escape hatch (a custom operation handler against the raw client).

## 7. Performance posture

Filters translate to Prisma's own indexed-field filter operators — no
raw SQL, no function-wrapping. No N+1: Prisma's `include` already
batches relation loads internally; `maxLimit` clamps upstream. Integration
tests run the real engine→adapter stack against a real Prisma Client on
SQLite (`tests/adapter.spec.ts`, `tests/soft-delete.spec.ts`,
`tests/includes.spec.ts`), per-package testing as specified — the shared
test schema and generated client are built by `pnpm generate`
(`prisma generate` + `prisma db push`), which `pnpm check` runs first.
