# 11 — Soft Delete, Restore & Purge (Phase 14)

Deleting a row can mean two things. Crudo resolves which one **per
entity, at bootstrap**, and every layer downstream reads that one answer
instead of re-deciding.

```ts
@Entity()
class Owner implements SoftDeletable {
  @DeleteDateColumn() deletedAt!: Date | null;
}
```

That is the whole opt-in. `DELETE /owners/:id` now stamps the marker
instead of removing the row, and every read excludes stamped rows.

## 1. Strategy resolution

`resolveSoftDelete(metadata, settings)` produces a `ResolvedSoftDelete`
— a two-member union, so `strategy: "soft"` always comes with a `field`:

| Settings                                | Result                                         |
| --------------------------------------- | ---------------------------------------------- |
| `softDelete: false`                     | `hard`                                         |
| `softDelete.strategy: "hard"`           | `hard`                                         |
| `softDelete.strategy: "soft"`           | `soft` — no marker field is a config error     |
| `softDelete.strategy: "auto"` (default) | `soft` when a marker field exists, else `hard` |

The marker field is the configured `softDelete.field` when the entity has
such a column, otherwise the one the ORM declares
(`EntityMetadata.softDeleteField` — `@DeleteDateColumn` in
`@crudo/typeorm`). Explicit configuration wins over detection; an entity
with neither costs nothing, which is the phase's constraint.

Resolution runs at every settings scope, so an operation or a single call
may narrow it (`operations: { deleteOne: { softDelete: { strategy: "hard" } } }`),
and the result rides on `CrudContext.config.softDelete`. Adapters branch
on that object — they never re-derive the decision.

## 2. Operations

| Operation    | Behavior                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `deleteOne`  | Hard or soft per the resolved strategy. Soft-deleting a deleted row → 409 `CRUDO_ALREADY_DELETED`.                                |
| `restoreOne` | Clears the marker, returns the revived row in the **`item`** slot — no new DTO shape. A live row → 409 `CRUDO_NOT_DELETED`.       |
| `purgeOne`   | Permanently removes an already-soft-deleted row. A live row → 409 `CRUDO_NOT_DELETED`. Under a hard strategy it is just a delete. |

Enablement is config-declared, not metadata-driven (**ADR-0013**):
`restoreOne` switches on with `softDelete: { strategy: "soft" }` (or an
explicit `softDelete.field`), `purgeOne` with
`operations: { purgeOne: true }`. Enabling either on an entity that
resolves to `hard` is a bootstrap `ConfigurationException`. Reads and
`deleteOne` still adapt with no config at all.

Routes come from the registry with no change to the generator:
`PATCH /:id/restore` (200) and `DELETE /:id/purge` (204).

## 3. Read semantics

Soft-deleted rows are invisible by default — to `findOne`, `findMany`,
`count`, and to `updateOne`/`patchOne`, which will not touch a deleted
row (reviving one is `restoreOne`'s job, not a side effect of a write).

`withDeleted=true` opts back in, on both wire and programmatic paths. On
an entity that is not soft-deletable the parameter is **rejected**
(`CRUDO_QUERY_UNSUPPORTED_PARAM`) rather than ignored: a client that
believes it is seeing deleted rows should be told it is not.

In `@crudo/typeorm` the flag translates two ways, because a marker column
is not always the ORM's own: for a `@DeleteDateColumn`, TypeORM already
excludes deleted rows and the adapter opts in with `.withDeleted()`; for
an ordinary column named through config, the adapter adds
`<alias>.<field> IS NULL` itself.

## 4. Edges

**Unique constraints.** A soft-deleted row still occupies its unique
indexes, so re-creating "the same" row raises a unique violation — mapped
to a 409 like any other conflict, which is the honest answer: the value
_is_ taken. Crudo does not rewrite indexes. The standard fix is a
partial/filtered unique index over live rows only:

```sql
CREATE UNIQUE INDEX owner_email_live ON owner (email) WHERE deleted_at IS NULL;
```

(Postgres and SQLite support that form directly; MySQL needs a generated
column.) The example app leaves the plain unique index in place so the
conflict is visible rather than hidden.

**Cascading soft delete is deliberately not automatic.** One `DELETE`
silently stamping rows across several tables is a footgun — invisible in
the request, hard to reverse correctly, and impossible to reason about
from the route alone. The documented pattern is an explicit cascade
written by the caller (a custom operation, Phase 13), which also gets to
decide ordering and what to do when one leg fails.

**Related rows.** Soft-deleted related rows are excluded from included
relations (Phase 15) by the same rule that governs root reads — the
adapter spells the child predicate out per join rather than leaving it to
the ORM's default. See doc 12 §4.

## 5. What is not here

Bulk (`restoreMany`, `deleteMany`, …) is the optional half of Phase 14
and is not built: those registry entries stay disabled, and calling one
raises `OperationDisabledException`. The single-item surface is complete
without it — `BulkResultDto` and the `*Many` contracts remain reserved.
