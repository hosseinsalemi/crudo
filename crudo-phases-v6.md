# Crudo — Framework Build Phases (v6)

Phase-by-phase prompt chain for designing and implementing **Crudo**, a
production-grade CRUD framework in TypeScript, built to be published to npm.
Feed each phase as its own prompt, in order. Every phase states its
dependencies so you can re-run one phase in isolation.

**v6 scope (deliberately narrow):** REST only, and only three packages —
`@crudo/core`, `@crudo/typeorm`, `@crudo/nest`. No validator package, no
authorization/policy layer, no hooks/events system, no audit trail, no
published contract-test suite, no future-adapter proofs. Those are removed
from this document, not merely deferred. Everything else (Prisma, Sequelize,
Express, Fastify, GraphQL, …) is out of scope.

The design still keeps **ORM independence inside `@crudo/core`** as a
structural discipline (it's what keeps the core clean), but the only adapter
built is TypeORM, and the only framework binding built is NestJS.

---

## Naming Conventions (normative)

Every later phase uses these; deviations are review findings.

- **Packages:** `@crudo/<thing>`, lowercase.
- **DTO slots:** `create`, `update`, `patch`, `query`, `item`, `list` —
  bare verbs, because `createOne` and `createMany` share the `create` DTO.
- **DTO classes:** request bodies are `<Verb><Entity>Dto` (`CreateUserDto`,
  `UpdateUserDto`, `PatchUserDto`); query and response shapes are
  `<Entity><Slot>Dto` (`UserQueryDto`, `UserItemDto`, `UserListDto`).
- **`Dto` suffix rule:** every wire-crossing shape carries the `Dto`
  suffix — user DTO classes _and_ framework-owned envelopes and fragments
  (`ListResultDto`, `ListMetaDto`, `BulkResultDto`, `ProblemDetailsDto`).
  Behavioral contracts (services, adapters, registries) never do.
- **Operations:** camelCase, and every operation names its cardinality
  explicitly — `<verb>One` for single-target (`createOne`, `findOne`,
  `updateOne`, `patchOne`, `deleteOne`, `restoreOne`, `purgeOne`),
  `<verb>Many` for batch (`findMany`, `createMany`, `updateMany`,
  `patchMany`, `deleteMany`, `restoreMany`). Operation ids in config
  (`operations.deleteOne`) use the same names. "Bulk" is the feature term,
  never a method prefix: config key `bulk`, `/bulk` routes, `BulkResultDto`.
- **Filter operators:** AST enum in SCREAMING_SNAKE (`EQ` … `IS_NOT_NULL`);
  wire tokens in camelCase (`eq` … `isNotNull`), exact-case matched. The
  mapping table in Phase 5 is the single source of truth.
- **Envelope fields:** `items`, `limit`, `offset`, `total`, `meta`; the
  default pagination wire params use the same `limit`/`offset` names
  (Phase 5), so request and response mirror each other.
- **Exceptions:** `*Exception` classes; stable string codes in
  `CRUDO_SNAKE_CASE` (`CRUDO_NOT_FOUND`).
- **Factories:** `create*` (`createCrudo`, `createCrud`).
- **Config keys:** camelCase; booleans phrased positively
  (`exposeInternals`, never `hideInternals`).
- **Data access:** `EntityReader` (reads) + `EntityWriter` (writes);
  `RepositoryAdapter` = both. Adapters are named for what they adapt
  (`TypeOrmRepositoryAdapter`).

---

## Milestone Map

| Milestone                | Phases | Checkpoint — what runs when it's done                                                                                                                                                                                                   |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Blueprint**        | 1–3    | Architecture, monorepo, contracts. No runtime code.                                                                                                                                                                                     |
| **B — Walking skeleton** | 4–12   | End-to-end basic CRUD (`createOne`/`findOne`/`findMany`/`updateOne`/`patchOne`/`deleteOne`, hard delete) through TypeORM behind generated NestJS routes, with filtering/sorting/pagination, layered config, and problem-details errors. |
| **C — Core features**    | 13–15  | Operation control (disable/override/custom), soft delete/restore/purge, nested relation includes.                                                                                                                                       |
| **D — Ship**             | 16–18  | DX polish, reference application, npm release.                                                                                                                                                                                          |

Deferral mechanics: the skeleton never blocks on later features. Crudo has no
standalone cross-cutting transaction system — the one place multi-write
atomicity matters (bulk `atomic` mode) gets a narrow adapter-level hook
specified in Phase 9/10, not a dedicated phase. Every other seam (soft-delete
strategy, relation loading, operation registry) exists from Phase 7 with a
plain default in it until its phase lands.

---

---

# MILESTONE A — BLUEPRINT

---

## PHASE 1 — SYSTEM ARCHITECTURE

**Goal:** Produce the top-level architecture before any code exists.

**Context:** A developer defines an entity once (via TypeORM) and gets
`createOne`, `findOne`, `findMany`, `updateOne`, `patchOne`, `deleteOne`,
`restoreOne`, the `*Many` batch variants, and arbitrary custom operations —
with filtering, sorting, pagination, nested relation inclusion, field
selection, optional per-operation DTOs, serialization, and error handling,
all configurable at **global, entity, operation, and per-call scope**.

**Requirements:**

- Clean Architecture with strict dependency inversion between core and
  adapters.
- SOLID compliance; Open/Closed Principle as the primary extensibility
  mechanism.
- Framework independence and ORM independence **inside `@crudo/core`** — even
  though only NestJS and TypeORM are built, core must not import either.
- Strong TypeScript typing end-to-end (no `any` at public boundaries); type
  inference is a feature — a consumer rarely writes a generic argument by
  hand.
- Bias toward **one mechanism, several behaviors** over parallel subsystems —
  DRY is a design constraint (see Phase 13 for where this matters most).
- Explicit performance posture: no N+1 by default (Phase 15), no unbounded
  queries (Phase 5 limits).
- **The milestone plan above is an architectural input:** the design must make
  Milestone B shippable without stubbing out Milestones C–D as hacks — seams,
  not TODOs.

**Deliverables:**

1. High-level architecture diagram (layers + boundaries; C4 level 2 altitude).
2. Dependency graph (who is allowed to import whom).
3. Package architecture overview (three packages).
4. Request lifecycle (first pass — authoritative version in Phase 7).
5. Module responsibilities.
6. Design patterns used, and why each was chosen over alternatives.
7. Sequence diagrams for create / findMany / update / delete.
8. **Explicit non-goals list** (not an ORM, not a query language beyond the
   CRUD surface, no GraphQL, no validation subsystem, no policy layer) —
   scope-creep insurance.
9. **Glossary** — one canonical name per concept (operation, adapter,
   reader/writer, include, envelope), consistent with the Naming Conventions
   section; every later phase uses these terms and no synonyms.
10. Short ADR list: one ADR per load-bearing decision, referenced by later
    phases instead of re-arguing.
11. Tradeoff analysis.

**Constraints:** Architecture only — no implementation code.

---

## PHASE 2 — MONOREPO & PACKAGE DESIGN

**Depends on:** Phase 1.

**Target structure (packaging preserved for future growth, populated only
where v6 builds something):**

```
packages/
├─ core/            ← @crudo/core
├─ orms/
│  └─ typeorm/      ← @crudo/typeorm
├─ frameworks/
│  └─ nest/         ← @crudo/nest
├─ examples/        ← the Phase 17 reference application
└─ docs/
```

**Current packages:** `@crudo/core`, `@crudo/typeorm`, `@crudo/nest` — that is
the entire v6 surface. The `orms/` and `frameworks/` parent folders keep the
door open for future adapters without implying any get built now.

**Deliverables:**

1. Complete folder structure, one level into each package.
2. Responsibility statement per package — why it exists, what it can't depend
   on. In particular: `@crudo/core` depends on neither TypeORM nor NestJS.
3. Dependency rules, **mechanically enforced**: TS project references for
   build-order correctness plus a lint-level boundary checker
   (dependency-cruiser or eslint import boundaries) so an illegal import
   fails CI, not code review.
4. Workspace tooling decision (pnpm workspaces assumed; plain scripts vs. a
   task runner — pick one, justify it).
5. Public vs. internal API surface per package (`exports` map sketch; deep
   imports are not API).
6. Build strategy (incremental builds, project references graph).
7. Versioning strategy (independent vs. lockstep — pick one, justify it; full
   release mechanics live in Phase 18).
8. Note on which packages will have `peerDependencies` (`typeorm`,
   `@nestjs/*`) vs. `dependencies` — decided here, executed in Phase 18.

**Constraints:** No implementation code. Every package must earn its place.

---

## PHASE 3 — CORE CONTRACTS & TYPE SYSTEM

**Depends on:** Phases 1–2.

**Hard constraint:** `@crudo/core` must not depend on NestJS or TypeORM,
directly or transitively. Zero runtime dependencies.

All contracts are declared here — including ones whose implementations land in
Milestone C — so the type system is complete before the first line of runtime
code, and later phases never mutate `@crudo/core` types.

**Required interfaces (v6 set):**
`CrudService<Entity, ...>`, `RepositoryAdapter<Entity>`,
`EntityReader<Entity>`, `EntityWriter<Entity>` (the read/write halves —
`RepositoryAdapter` extends both), `Serializer`,
`Deserializer`, `FilterBuilder`, `FilterParser`, `CrudContext`,
`QueryContext`, `CrudRequest`, `CrudResponse`, `Pagination`, `Sort`,
`Filter`, `FieldSelection`, `CrudException`, `ErrorHandler`.

**Contracts for later phases (declared now, implemented then):**

- `RelationRegistry<Entity>` / `RelationDescriptor` / `IncludeResolver` /
  `IncludeTree` — nested includes (Phase 15).
- `GlobalConfig` + `ResolvedEntityConfig<Entity>` — raw global config and
  the frozen, fully-merged per-entity result (Phase 8).
- `OperationRegistry<Entity>` / `OperationHandler` / `OperationMetadata` —
  the operation table the engine dispatches through (mechanics in Phase 7,
  control surface in Phase 13). `OperationMetadata` is the opaque,
  module-augmentable `meta` slot the NestJS layer uses to attach route
  concerns without core knowing about them (Phase 11).
- `BulkResultDto<ItemDto>` — bulk envelope (Phase 14, if bulk is built;
  otherwise reserved).
- `FieldPath<Entity>` — template-literal type for dot-paths (`'profile.city'`)
  with a hard recursion cap, used by filter/sort/include typings so relation
  paths are spell-checked at compile time.

**DTO-aware generics:** `CrudService`/`CrudRequest`/`CrudResponse` carry
generic slots for all six DTO positions from Phase 4 — `CreateDto`,
`UpdateDto`, `PatchDto`, `QueryDto`, `ItemDto`, `ListDto` — each
defaulting to a type derived from `Entity`.

**Deliverables:**

1. Complete TypeScript interfaces for everything listed above.
2. A table explaining every generic parameter: purpose, default, override
   example.
3. `FieldPath` implementation notes: recursion cap, behavior on `any`/index
   signatures, why the cap exists (compiler blowup).
4. Module-augmentation pattern for `OperationMetadata`, with a worked example
   showing `@crudo/nest` declaring a `routes` key.
5. A short note on why `@crudo/core` has zero runtime dependencies.

**Constraints:** Interfaces and types only. No classes, no implementations.

---

---

# MILESTONE B — WALKING SKELETON

---

## PHASE 4 — OPTIONAL DTO SYSTEM (item / list)

**Depends on:** Phase 3.

**Goal:** An independent, optional data contract per REST verb, with
zero-config entity-derived defaults, and a clean split between "one resource"
and "a list of resources."

**The six DTO slots:**

| Slot     | Verb / context                                                            | Purpose                                                                                | Default when omitted                             |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `create` | `POST`                                                                    | Request body for creation                                                              | Entity, minus generated/relation fields          |
| `update` | `PUT`                                                                     | Request body for full replace                                                          | Same default as `create`                         |
| `patch`  | `PATCH`                                                                   | Request body for partial update                                                        | `Partial<update>` if set, else `Partial<Entity>` |
| `query`  | `GET` (list)                                                              | Filters, sort, pagination, field selection, includes, `withDeleted` (Phases 5, 14, 15) | Generic `QueryContext<Entity>`                   |
| `item`   | Any single-resource response (`GET` one, `POST`, `PUT`, `PATCH`, restore) | Shape of one returned resource                                                         | `Entity`, subject to field selection             |
| `list`   | `GET` (list) response                                                     | The **element type inside `ListResultDto.items`**                                      | Same as `item`'s resolved type                   |

**Config surface:**

```ts
createCrud(UserEntity, {
  dto: {
    create: CreateUserDto, // optional
    update: UpdateUserDto, // optional
    patch: PatchUserDto, // optional — else derived from `update`
    query: UserQueryDto, // optional
    item: UserItemDto, // optional
    list: UserListDto, // optional — element shape used in the list envelope
  },
});
```

Every key is independently optional. `item` and `list` are split because a
list view often wants a leaner projection (e.g. `UserListDto` with just
`id`/`name`/`email`) than a detail view (`UserItemDto` with the full
resource).

**The list envelope (normative):**

```ts
interface ListResultDto<ListDto> {
  items: ListDto[];
  limit: number; // effective page size the server applied
  offset: number; // zero-based index of items[0] within the full match set
  total: number | null; // total matching items; null when counting is disabled
  meta: ListMetaDto; // open, extensible bag; core never writes to it
}
```

Design notes, stated once:

- Pagination fields are **flat at the top level** — first-class response data,
  not metadata; every consumer needs them.
- `limit`/`offset` are the field names (industry-standard, and they match the
  internal normalized form the pagination strategy produces); the default wire
  params use the same names (Phase 5), so a request and its response read
  symmetrically. `total` is nullable because `COUNT(*)` is a real cost the
  config can turn off.
- `meta` is the extension seam (e.g. a cursor strategy can add `meta.cursor`)
  without touching the envelope contract.

**Included relations:** when a response embeds an included relation (Phase 15),
the included node's shape is resolved from the **related entity's own
registered `item`/`list` DTOs** when that entity has a Crudo config, falling
back to its entity-derived default otherwise. No per-include DTO slot — the
related resource owns its own contract.

**Required interfaces:**

- `Dto` — marker type for anything usable as a DTO.
- `OperationDtoMap<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>`.
- `ListResultDto<ListDto>` / `ListMetaDto` — as above.
- `DtoResolver<Entity>` — resolves the effective DTO per operation at runtime.

**Deliverables:**

1. `OperationDtoMap`, `ListResultDto`, `DtoResolver` full definitions.
2. Default-derivation rules per slot, precisely specified — including edge
   cases: generated columns, relation properties, getters, embedded objects.
3. Resolution algorithm: explicit-DTO vs. derived-default, per slot,
   independently; where the resolver result is cached (per entity, at
   bootstrap — not per request).
4. Interaction with field selection and `Serializer`; serialization order is
   DTO mapping → field selection.
5. The included-relation DTO resolution rule above, precisely specified.
6. Note that restore (Phase 14) and custom operations (Phase 13) reuse
   `item`/`list` rather than adding new slots.

**Constraints:** Interfaces and resolution rules only. DTOs in v6 are shapes
for typing, serialization, and Swagger docs — there is no validation
subsystem attached to them.

---

## PHASE 5 — QUERY MODEL, FILTER ENGINE & QUERY STRING GRAMMAR

**Depends on:** Phase 3 (`Filter`, `FilterBuilder`, `FilterParser`),
Phase 4 (`query`).

**Goal:** Design the provider-independent query system, including a fully
specified default query-string dialect for the `query` DTO to parse into.

**Operators — AST names and wire tokens (single source of truth):**

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

Wire tokens are camelCase and exact-case matched — one spelling, no aliases.
**Logical operators:** `AND`, `OR`, `NOT` (wire: `and`, `or`, `not`).

Core ships exactly this set. (An operator registry mapping wire tokens to AST
factories is a natural extension point, but v6 does not need to build it —
mention it, don't implement it.)

### Query string grammar (default reference implementation)

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
  &fields[posts]=id,title
  &include=profile,posts.comments
  &withDeleted=false
```

Resolves to:

```
AND[
  age GTE 18,
  status IN [active, pending],
  name LIKE "%john%",
  OR[ role EQ "admin", status EQ "banned" ]
]
sort:       [{ field: createdAt, dir: desc }, { field: name, dir: asc }]
pagination: { limit: 20, offset: 20 }
fields:     root: [id, name, email]; posts: [id, title]
include:    tree { profile: {}, posts: { comments: {} } }
withDeleted: false
```

**Grammar rules:**

- **Filters:** `filter[field][operator]=value`. Multiple `filter[...]` params
  AND together implicitly.
- **Multi-value operators** (`IN`, `NOT_IN`): comma-separated by default;
  repeated-key form (`filter[status][in][]=a&...`) also accepted.
- **`BETWEEN`:** two comma-separated bounds.
- **`IS_NULL`/`IS_NOT_NULL`:** boolean-valued, no real comparison value.
- **`LIKE`/`ILIKE`:** the parser does **not** auto-wrap wildcards — callers
  pass `%` explicitly. Literal `%`/`_` must be escapable; the escape
  convention is specified here once.
- **Relation-path filtering:** dot notation (`filter[profile.city][eq]=Helsinki`),
  only permitted for paths on the entity's filterable allowlist. Relation-path
  filters **restrict root rows**; they never filter the included collection
  (that distinction is Phase 15's).
- **Nested boolean trees:** `filter` also accepts a single JSON-encoded value
  (`?filter={"or":[...],"not":{...}}`) parsed into the same AST. Bracket
  notation is sugar for the common flat-AND case (with one-level `or`/`not`
  groups); JSON is the full-power escape hatch — both produce the identical
  AST.
- **Sort:** comma-separated field list; `-` prefix = descending; list order is
  priority order. Relation-path sort (`sort=-profile.rating`) allowed only for
  allowlisted paths.
- **Pagination:** a pluggable `PaginationStrategy`. Default: flat
  `limit`/`offset` (offset 0-based) — the exact field names the
  `ListResultDto` envelope reports back (Phase 4). A `page[number]`/`page[size]`
  strategy (1-indexed, normalized internally to `limit`/`offset`) ships as a
  built-in alternative.
- **Field selection:** `fields=id,name,email` — sparse fieldset for the root
  resource; `fields[<relation>]=...` — sparse fieldset for an included
  relation (Phase 15). If omitted, everything the resolved DTO allows is
  returned.
- **Relation inclusion:** `include=profile,posts.comments` — surface syntax
  defined here; loading semantics are Phase 15's. The skeleton parses and
  rejects `include` as unsupported until then, explicitly — not silently.
- **Soft delete flag:** `withDeleted=true` (semantics in Phase 14; rejected as
  unsupported until then).

**Security & robustness:**

- Every entity declares (via `query` DTO or config) an allowlist of
  filterable/sortable/selectable fields and relation paths. Anything outside
  it is rejected with a 400 (Phase 6 `QueryValidationException`), not silently
  dropped.
- Configurable limits, defaulted at global scope (Phase 8), overridable per
  entity: max filter-tree depth, max `IN`/`BETWEEN` array length, max `limit`.
- Type coercion: raw string query values are coerced against entity column
  metadata (number/boolean/Date/enum) before becoming AST nodes; coercion
  failures become field-level query errors, not silent `NaN`/`Invalid Date`
  bugs. Coercion is locale-independent and documented per type (ISO 8601 for
  dates, `true`/`false`/`1`/`0` for booleans).

**Deliverables:**

1. Query model (normalized shape after `query` DTO parsing).
2. Filter AST and `FilterExpression` hierarchy, including `NOT` nodes.
3. Specification Pattern design for composable filters.
4. Filter Builder and Filter Parser contracts, including `PaginationStrategy`.
5. The full grammar specification above (operator table included), as a
   standalone reference document — this becomes end-user documentation
   verbatim.
6. Query normalization pipeline (raw query string → validated → AST),
   including where each limit is enforced and which Phase 6 error each
   violation raises.

**Constraints:** ORM-independent. No TypeORM translation yet (Phases 9–10).

---

## PHASE 6 — ERROR HANDLING

**Depends on:** Phases 3, 5.

**Exceptions:** `QueryValidationException` (bad filter/sort/include/fields
input), `NotFoundException`, `ConflictException`, `PersistenceException`,
`TransactionException`, plus base classes extended by later phases:
`AlreadyDeletedException` / `NotDeletedException` (Phase 14),
`OperationDisabledException` (Phase 13), and — reserved for bulk (Phase 14) —
a `BulkOperationException` capable of carrying per-item errors. The hierarchy
is designed now so later phases only add leaves.

**Wire shape:** the default serialized error is an **RFC 9457 problem-details**
document, `ProblemDetailsDto` (`type`, `title`, `status`, `detail`, plus
Crudo extensions: `code`, `errors[]` for field-level query issues, `items[]`
for per-index bulk failures). The NestJS layer maps it 1:1; anyone who wants a
different shape swaps the serializer, not the hierarchy.

**Error catalog:** every exception carries a stable, string-based `code`
(`CRUDO_NOT_FOUND`, `CRUDO_QUERY_INVALID_FIELD`, …) documented in one catalog
table: code → HTTP status → when it fires → payload extensions. Codes are API
surface — renaming one is a breaking change (Phase 18 semver policy).

**Message strategy:** human-readable `detail` strings are built from message
keys + params so a consumer can localize; core ships English defaults.
`exposeInternals` (global config, Phase 8) controls whether driver-level error
details leak into responses — off by default.

**Deliverables:**

1. Exception hierarchy (extensible without core changes).
2. The error-code catalog table.
3. Error metadata and error context shape (entity, operation, correlation id).
4. Error mapping strategy (adapter errors → Crudo exceptions); unknown adapter
   errors become `PersistenceException` with the original as `cause` — never
   swallowed.
5. Problem-details serialization strategy, including the per-item bulk shape
   (reserved now, used in Phase 14).

**Constraints:** Must not depend on NestJS's built-in exceptions — mapped in
`@crudo/nest` (Phases 11–12), not the reverse.

---

## PHASE 7 — CRUD ENGINE IMPLEMENTATION

**Depends on:** Phases 3–6.

**Request lifecycle (backbone — every stage boundary is a seam; seams marked
⟨deferred⟩ hold plain defaults until their phase lands):**

```
Request
 → Operation Resolution        (OperationRegistry lookup — control surface in Phase 13)
 → Config Resolution           (frozen ResolvedEntityConfig — Phase 8)
 → DTO Resolution              (explicit DTO, else Phase-4 default)
 → Deserialization
 → Query Resolution            (GET only: `query` → Filter AST; + IncludeTree from Phase 15 ⟨deferred⟩)
 → Repository Adapter call     (single adapter-level unit of work; multi-write
                                 atomicity, where it's needed, is scoped to
                                 bulk `atomic` mode — see Phase 9/10, Phase 14)
 → Response Mapping            (result → item or ListResultDto envelope)
 → Field Selection + Serialization
 → Response
```

This is a deliberately lean pipeline: no validation stage, no hook/event
stages, no policy stage. Cross-cutting behavior that those subsystems would
have provided is left to the consumer's own controller/service code around
Crudo — that is the v6 tradeoff, chosen for simplicity.

**Implement:** `CrudEngine`, `CrudService`, `CrudOperationExecutor`,
`CrudContext`, `OperationRegistry` (with the standard operations as its
default entries — the Phase 13 control surface configures this registry, it
doesn't introduce it).

**`CrudContext` contents (specified here, used everywhere):** entity +
operation identity, resolved config, principal (opaque to core — set by the
framework layer, available to custom operation handlers), the parsed query
context for reads, correlation id, and a typed per-request `state` bag for
custom handlers to pass data. There is no ambient transaction handle: Crudo
has no cross-operation transaction API (see the Milestone Map's deferral
mechanics note and Phase 9/10's `runInTransaction` hook for the one place
multi-write atomicity is actually needed).

**Patterns required:** Template Method (the lifecycle above), Strategy
(adapters/serializers/pagination), Dependency Injection.

**Constraints:** Independent of NestJS and TypeORM. Production-grade
TypeScript, not pseudocode. The ⟨deferred⟩ seams must be real interfaces with
plain defaults — not commented-out code.

---

## PHASE 8 — CONFIGURATION SYSTEM: GLOBAL, ENTITY, OPERATION

**Depends on:** Phases 4, 7.

**Goal:** One layered configuration model with a single, fully specified
precedence chain:

```
built-in defaults → global (framework scope) → entity → operation → per-call override
```

**Global (framework-scope) configuration.** Core-level entry point is a root
factory; the framework layer wraps it:

```ts
// framework-agnostic (core)
const crudo = createCrudo({
  defaults: {
    pagination: { defaultLimit: 20, maxLimit: 100, strategy: "offset" },
    query: { maxFilterDepth: 3, maxInValues: 100 },
    errors: { exposeInternals: false },
    // keys added by later phases, reserved in the schema now:
    relations: { maxIncludeDepth: 2, maxIncludedNodes: 10 }, // Phase 15
    softDelete: { field: "deletedAt" }, // Phase 14
    bulk: { mode: "atomic", maxBatchSize: 500 }, // Phase 14
  },
});
const userCrud = crudo.createCrud(UserEntity, {/* entity config */});

// NestJS skin (@crudo/nest, Phase 11)
CrudoModule.forRoot({
  orm: "typeorm",
  defaults: {/* same shape as above */},
  routes: {
    prefix: "api",
  },
});
```

The bare `createCrud(Entity)` zero-config path still works — it's an implicit
root instance with built-in defaults. Nothing about global config may tax the
zero-config case (Phase 16's constraint).

**Schema extensibility rule:** later feature phases (14, 15, 13) **add keys to
this schema**; they never add a second config mechanism. Each feature phase's
deliverables include its config keys, their scopes, and their defaults — this
phase owns the model, the merge algebra, and the lifecycle.

**Merge semantics (normative):**

- Scalars and objects-as-values: nearer scope **replaces** farther scope.
- `false` disables an inheritable feature where the schema allows it
  (`operations.patchOne: false`, `softDelete: false`).
- Route metadata (`meta`, consumed by `@crudo/nest`): merged
  global-routes → entity → operation.

**Resolution timing:** all merging happens **once at bootstrap** into a frozen
`ResolvedEntityConfig<Entity>` per entity (plus per-operation views). Config
is immutable after init — no runtime mutation API; per-call overrides are
parameters, not config writes. Invalid config fails fast at bootstrap with an
error naming the entity, the key path, and the offending value.

**Deliverables:**

1. Configuration model — full schema for global, entity, and operation scope,
   including the reserved keys for later phases.
2. The precedence chain and merge-semantics rules above, made normative.
3. `createCrudo` root-factory design; how `CrudoModule.forRoot` delegates to
   it; how the implicit default instance keeps zero-config working.
4. Registration system, factory architecture; entity registry.
5. Bootstrap validation design and error quality bar (every config error names
   entity + key path + expected shape).
6. Debug dump: a way to print the resolved config for one entity.

**Constraints:** Complete implementation, not just types. Core owns the model
and merging; `@crudo/nest` only contributes its `routes` keys via the
`OperationMetadata` augmentation (Phase 3).

---

## PHASE 9 — TYPEORM ADAPTER — ARCHITECTURE (skeleton scope)

**Depends on:** Phases 3, 5, 6, 7, 8.

**Feature scope (this milestone):** createOne, findOne, findMany, updateOne,
patchOne, deleteOne (hard); filtering, sorting, pagination. Later features
extend this adapter in their own phases: soft delete/restore/purge (14),
relation loading (15). The architecture must show where each future concern
will attach so none of them forces a rewrite.

**Transactions, scoped down:** Crudo has no standalone Transaction System
phase — that surface (propagation modes, ambient context, nested-transaction
savepoints) was cut because nothing in v6 needs it except one thing: bulk
`atomic` mode (Phase 14) needs a list of writes to commit or roll back
together. This phase specifies that need directly as a narrow adapter-level
hook — `runInTransaction<T>(fn: (adapter: RepositoryAdapter<Entity>) =>
Promise<T>): Promise<T>` — backed by TypeORM's `QueryRunner`/`EntityManager`.
It is not part of `CrudContext`, not exposed to application code as a public
API, and carries no propagation semantics: it exists solely so Phase 14's
`atomic` bulk mode has somewhere to call. If a consumer needs their own
multi-entity atomicity across separate `userCrud`/`profileCrud` calls, that's
out of scope for v6 — they reach for the underlying `DataSource`/`QueryRunner`
directly, same as they would without Crudo.

**Deliverables:**

1. Adapter architecture and its position relative to `@crudo/core`
   (`TypeOrmRepositoryAdapter` implementing `RepositoryAdapter` =
   `EntityReader` + `EntityWriter`).
2. Query translation strategy (Filter AST → TypeORM `QueryBuilder`), including
   `NOT` nodes and relation-path filters (joins added for filtering only,
   without selecting).
3. Repository API vs. QueryBuilder API — when each is used and why.
4. Pagination translation (`offset`/`limit` → `skip`/`take`), and the
   count-query strategy for `ListResultDto.total` — including how `total: null`
   (counting disabled) skips the count query entirely, and avoiding
   `getManyAndCount` when count is not requested.
5. **Error mapping table:** driver error → Crudo exception (unique violation →
   `ConflictException`, FK violation → `ConflictException` with relation
   context, serialization/deadlock → `TransactionException` with a `retryable`
   flag, everything else → `PersistenceException` with `cause`).
6. `runInTransaction<T>` hook design (as scoped above), plus attachment
   points for Phases 14 and 15 (named seams, one paragraph each).
7. Performance considerations (index-aware filtering/sorting).

**Constraints:** Architecture and decisions only — implementation is Phase 10.

---

## PHASE 10 — TYPEORM ADAPTER — IMPLEMENTATION (skeleton scope)

**Depends on:** Phase 9.

**Requirements:** Full Repository/QueryBuilder support for the skeleton scope:
CRUD (hard delete), filtering (incl. relation paths and `NOT`), sorting,
pagination with optional counting. Translate the Filter AST into `QueryBuilder`
calls. Consume resolved config (Phase 8) — the adapter reads limits and
conventions from `ResolvedEntityConfig`, it never re-declares defaults.

**Constraints:** Do not modify `@crudo/core` contracts — revisit Phase 9 if
something doesn't fit. Write focused integration tests against a real database
(testcontainers or equivalent) so the adapter's behavior is verifiable; this
is per-package testing, not a shared published suite.

---

## PHASE 11 — NESTJS INTEGRATION — ARCHITECTURE

**Depends on:** Phases 4, 6, 8 (and the operation registry from Phase 7).

**Developer goal:**

```ts
@Crud(UserEntity)
@Controller("users")
export class UserController {}
```

**Route generation reads the operation registry:** generates a route for every
enabled operation — in this milestone, the six standard CRUD routes. The
generation rules are written against the registry, not a hardcoded verb list,
so later phases (restore/purge in 14, custom operations in 13, bulk in 14) get
routes by adding registry entries — zero changes to the generation mechanism.
It also skips any operation where a hand-written controller method already
exists (**manual-method-wins**: the factory detects the method on the class
prototype and skips auto-generating that route — no route conflicts, no config
required for a genuine one-off).

**DTO integration:** a registered DTO drives `@Body()`/`@Query()` types and
the Swagger schema — list endpoints use the `ListResultDto` envelope
(`items`/`limit`/`offset`/`total`/`meta` documented), error responses document
the Phase 6 problem-details shape per status code. `filter[...]`, `sort`,
`limit`/`offset`, and `fields` are documented as Swagger query params from the
entity's actual allowlists — generated docs reflect what the API really
accepts. No DTO registered → Nest generates an equivalent shape from entity
metadata.

Note: v6 ships no validation subsystem. If a team wants request-body
validation, they wire NestJS's own `ValidationPipe` and class-validator
decorators on their DTO classes in the usual NestJS way — Crudo neither
requires nor provides it.

**Exception mapping:** one exception filter maps Phase 6 exceptions to HTTP
responses (problem-details body, correct status from the error catalog). Crudo
exceptions never extend Nest's — the filter is the boundary.

**Deliverables:**

1. Package architecture, dynamic module design (`forRoot`/`forFeature`, async
   variants).
2. Controller/route generation strategy: registry-driven generation and the
   manual-method-wins detection, written to be feature-phase-proof.
3. Metadata architecture (`@Crud` decorator → module), route naming/version
   strategy (Nest versioning compatibility).
4. DI integration (how adapters and custom operation handlers enter Nest's
   container; request-scoped vs. singleton decisions, justified).
5. Swagger integration architecture, including query-param and error-shape
   generation.

**Constraints:** Architecture only — implementation is Phase 12.

---

## PHASE 12 — NESTJS INTEGRATION — IMPLEMENTATION

**Depends on:** Phase 11.

**Provide:** `CrudoModule`, `CrudFactory`, `CrudExplorer`,
`CrudControllerFactory`, `@Crud` decorator, and the exception filter.

**Features:** automatic CRUD endpoints for the skeleton scope; query-string
parsing wired to the Phase 5 grammar; `ListResultDto` envelope on list
routes; Swagger support incl. problem-details error schemas; DI.

**Milestone B checkpoint:** at the end of this phase, a demo app with one
entity serves working CRUD over HTTP with filtering, sorting, pagination,
layered config, and problem-details errors — no operation control, no soft
delete, no relations, no bulk. That app becomes the seed of the Phase 17
reference application.

**Constraints:** Production-grade implementation, e2e-tested against a real
Nest app.

---

---

# MILESTONE C — CORE FEATURES

Each phase in Milestone C is a vertical slice: core design + engine wiring +
TypeORM integration + NestJS integration + config keys + tests, in one phase.
A feature isn't done until it works over HTTP.

---

## PHASE 13 — OPERATION CONTROL: DISABLE, OVERRIDE & CUSTOM METHODS

**Depends on:** Phases 4, 7, 8, 11.

**Goal:** One mechanism for three developer-facing needs: turning an operation
off, replacing its built-in behavior, and adding an entirely new operation —
all flowing through the same pipeline (DTOs, serialization) that standard CRUD
operations use.

**Design:** the engine already dispatches every operation through
`OperationRegistry<Entity>` (Phase 7) — the built-in handlers are just
default registry entries, nothing about them is special-cased. This phase adds
the developer-facing control surface over that registry. Each entry is an
`OperationHandler<Entity, Input, Output>`:

```ts
interface OperationHandler<Entity, Input, Output> {
  execute(input: Input, ctx: CrudContext<Entity>): Promise<Output>;
}
```

| Need         | What happens                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Disable**  | The registry entry is removed/deactivated. No service method (calling it throws `OperationDisabledException`), no route generated.     |
| **Override** | The registry entry's handler is swapped for a custom one. Same DTO/serialization scaffolding stays in place around it by default.      |
| **Custom**   | A new entry is added with its own input/output DTOs. Runs through the same pipeline and gets its own generated route in `@crudo/nest`. |

**The `meta` slot:** every registry entry carries an `OperationMetadata` bag —
opaque to core, typed via module augmentation by whoever consumes it (Phase 3).
`@crudo/nest` augments it with route options and Swagger overrides. Core's only
contract: store it, merge it per Phase 8 precedence, hand it to the framework
layer.

**Config surface:**

```ts
createCrud(UserEntity, {
  operations: {
    updateOne: { handler: CustomUpdateHandler }, // overridden, keeps default scaffolding
    patchOne: false, // disabled
  },
  customOperations: {
    activate: {
      input: ActivateUserDto,
      output: UserItemDto,
      handler: ActivateUserHandler,
      http: { method: "POST", path: ":id/activate" }, // consumed by @crudo/nest
    },
    recalculateStats: {
      input: RecalcDto,
      output: StatsDto,
      handler: RecalcHandler,
      http: false, // service-only: callable in code, no route
    },
  },
});
```

**Deliverables:**

1. `OperationHandler` control surface over the Phase 7 registry, including the
   `meta` merge behavior.
2. Config surface for disable/override/custom, and precedence rules when
   layered with global/entity-level config (Phase 8).
3. Decision: an _overridden_ standard operation still gets the default
   DTO-resolution/serialization scaffolding automatically (yes — its
   input/output shape is still entity-like), while a _custom_ operation must
   declare its own DTOs explicitly (yes — its shape isn't guaranteed CRUD-like),
   and why that split is the safer default.
4. `http: false` service-only operations, precisely specified.
5. **NestJS integration:** route generation for custom operations and
   suppressed routes for disabled ones, via the Phase 11 registry-driven
   mechanism (this phase should require zero changes to that mechanism — if it
   doesn't, Phase 11 was wrong; fix it there).
6. Guidance on choosing override (same semantics, new implementation) vs.
   custom operation (a genuinely new endpoint).

**Constraints:** Core-level concept — `OperationRegistry` has no NestJS or
TypeORM awareness; the framework/ORM layers just read it (including `meta`).

---

## PHASE 14 — SOFT DELETE, RESTORE & PURGE

**Depends on:** Phases 3, 7, 10, 13.

**Design:**

- `SoftDeletable<Entity>` — declares the delete-marker field (default:
  `deletedAt: Date | null`, configurable globally in Phase 8, overridable per
  entity).
- Delete strategy resolution: `hard` (default when not `SoftDeletable`) vs.
  `soft` (default when it is) — explicit override always available.
- `EntityWriter` gains `restore(id, ctx): Promise<Entity>`.
- `findOne`/`findMany` exclude soft-deleted rows by default; `query`'s
  `withDeleted` flag (Phase 5) opts in.
- New exceptions extending Phase 6's hierarchy for already-deleted /
  not-deleted-cannot-restore cases, both mapping to `ConflictException`.
- **Purge:** permanently deleting an already-soft-deleted row is an optional
  operation (`purgeOne`) registered through the Phase 13 registry, disabled by
  default.
- No new DTO slot — restore reuses `item` (Phase 4).

**Bulk (optional, same phase):** if the batch `*Many` variants are wanted,
build them here as a thin loop over the single-item pipeline plus the
`BulkResultDto<ItemDto>` envelope (`succeeded`, `failed[]`, counts), with
`atomic` (single adapter-level transaction via the Phase 9/10
`runInTransaction` hook) vs. `bestEffort` (per item) modes and a
batch-size limit from config. `createMany`/`updateMany`/`patchMany`/
`deleteMany`/`restoreMany` are **list-based, never filter-based** (no unbounded
mass writes). If bulk is out of scope for a given build, drop it — the
single-item CRUD surface is complete without it.

**Edges that must be specified:**

- **Unique constraints:** a soft-deleted row still occupies unique indexes.
  Document the standard fix (partial/filtered unique index
  `WHERE deletedAt IS NULL`) as adapter guidance — Crudo doesn't rewrite
  indexes, but it must map the resulting conflict error correctly.
- **Cascading soft delete:** deliberately **not** automatic in v6 (silent
  multi-entity writes are a footgun); the documented pattern is a caller
  writing the cascade explicitly.

**Deliverables:**

1. `SoftDeletable` contract and per-entity/operation delete-strategy config
   keys (added to the Phase 8 schema).
2. `restoreOne`/`purgeOne` contracts; default-exclusion + `withDeleted`
   behavior, precisely specified.
3. New exception types and mapping rules, including the unique-conflict case.
4. **TypeORM integration:** `@DeleteDateColumn` detection vs. explicit config;
   `withDeleted` translation; restore/purge implementation.
5. **NestJS integration:** `PATCH /users/:id/restore` and
   `DELETE /users/:id/purge` routes via the registry.
6. (If bulk built) `BulkResultDto` design, atomic vs. best-effort semantics,
   and `POST /users/bulk` etc. routes.

**Constraints:** Zero cost for entities that aren't soft-deletable.

---

## PHASE 15 — RELATION SYSTEM & NESTED INCLUDES

**Depends on:** Phases 3, 4, 5, 8, 10, 14.

**Goal:** First-class, safe, nested relation inclusion —
`include=posts.comments,profile` — with per-relation control over what may be
included, how deep, with which fields, and how it's loaded. This phase owns
everything between the parsed `include` string and the adapter call, plus the
adapter translation itself.

**Relation registry:** each entity declares its relations in an
`RelationRegistry<Entity>` (populated from ORM metadata by the adapter,
overridable in config). Each `RelationDescriptor` carries:

- `name`, `target` entity, cardinality (`one` | `many`).
- `includable: boolean` (default: **false** — inclusion is opt-in, an
  allowlist, consistent with Phase 5's filter/sort posture).
- `defaultInclude?: boolean` — included even when the client doesn't ask.
- `maxDepth?` override below this node.
- loading strategy hint: `join` | `batch` | `auto` (default `auto`).

Selectable/filterable/sortable fields of an included node come from the
**target entity's own config** — a relation never widens what its target
exposes.

**Include resolution algorithm (`IncludeResolver`):**

1. Parse comma-separated dot-paths into a tree; overlapping paths merge
   (`posts` + `posts.comments` → one `posts` node with a `comments` child).
2. Validate every edge against the relation registry: unknown relation or
   `includable: false` → 400 (`QueryValidationException`), never silently
   dropped.
3. Enforce limits: global/entity `maxIncludeDepth` (global default: 2), max
   total included nodes, per-relation `maxDepth` overrides.
4. Cycle guard: the same entity type may appear twice on a path but resolution
   is bounded by depth, never by visited-type tracking — depth is the contract.
5. Attach per-node sparse fieldsets from `fields[<relation>]` (Phase 5);
   validate them against the target entity's selectable allowlist.
6. Output: a validated `IncludeTree` handed to the adapter — the adapter never
   re-validates.

**Loading strategies (adapter contract):**

- `join` — single query with joins. Correct default for to-one relations.
- `batch` — one additional query per relation level, batching parents by id
  (`WHERE parentId IN (...)`), stitched in memory. Correct default for to-many
  relations: it avoids row-explosion and sidesteps the joined-pagination trap.
- `auto` — the heuristic above (to-one → join, to-many → batch).

**Pagination correctness rule (normative):** root pagination always counts and
slices **distinct root entities**, never joined rows. Any strategy that would
multiply root rows (joining a to-many) must either batch-load that relation or
paginate root ids first.

**Interplay:**

- **Sparse fieldsets:** primary/foreign keys needed for stitching are always
  fetched internally, then stripped at serialization if not selected.
- **Soft delete (Phase 14):** soft-deleted related rows are excluded from
  includes by default. Root-level `withDeleted` applies to the root only; a
  per-include `withDeleted` is deliberately **not** in v6.
- **DTOs (Phase 4):** included node shape = target entity's registered
  `item`/`list` DTO, else its derived default.
- **`findOne` supports `include`** with identical semantics.

**Write-side decision (explicit):** v6 supports **association by id** —
`create`/`update`/`patch` DTOs may carry scalar FK fields or `{ id }`
references for to-one, and id arrays for to-many where the ORM supports it.
**Deep nested writes (cascade create/update of child objects in one payload)
are out of scope**: they explode the transaction surface for a minority use
case. The decision, its rationale, and the extension point are documented.

**Deliverables:**

1. `RelationRegistry`, `RelationDescriptor`, `IncludeResolver`,
   `IncludeTree` implementations (contracts exist since Phase 3).
2. The resolution algorithm above, precisely specified, with error cases
   mapped to Phase 6 exceptions.
3. Loading-strategy contract and the normative pagination rule.
4. Sparse-fieldset stitching rules (keys kept internally, stripped late).
5. **TypeORM integration:** `join` → `leftJoinAndSelect` with deterministic
   alias management for nested paths; `batch` → per-level `IN` queries +
   in-memory stitching; the paginate-root-ids-first fallback when a to-many
   join is unavoidable.
6. **NestJS integration:** `include` and `fields[relation]` query params wired
   and Swagger-documented from the relation registry's actual allowlists.
7. Config keys added to the Phase 8 schema (`relations.maxIncludeDepth`,
   `maxIncludedNodes`, per-relation descriptors).
8. The write-side ADR: associate-by-id in v6, deep nesting deferred.

**Constraints:** Core resolution stays ORM-independent; only deliverable 5
touches `@crudo/typeorm`.

---

---

# MILESTONE D — SHIP

---

## PHASE 16 — DEVELOPER EXPERIENCE API

**Depends on:** Phases 8, 12, and the Milestone C feature set.

**Examples to cover:**

```ts
const userCrud = createCrud(UserEntity); // zero-config, implicit defaults

const crudo = createCrudo({ defaults: { pagination: { maxLimit: 50 } } });
const userCrud = crudo.createCrud(UserEntity, {
  dto: { item: UserItemDto, list: UserListDto },
});

const { items, total, limit, offset } = await userCrud.findMany({
  include: ["posts.comments"],
  fields: { posts: ["id", "title"] },
});

await userCrud.deleteOne(id); // soft delete, if UserEntity is SoftDeletable
await userCrud.restoreOne(id);

@Module({ imports: [CrudoModule.forFeature([UserEntity])] })
export class UserModule {}
```

**Deliverables:**

1. Public API reference, fluent/builder API surface, registration APIs.
2. Side-by-side usage examples: zero-config vs. partial vs. fully configured
   (global + entity + custom operations).
3. Migration guide from bare `createCrud(Entity)` to a fully configured setup.
4. **Type-inference acceptance tests** (expectTypeOf/tsd): the include-path
   strings, DTO slots, and envelope fields must infer correctly in the
   examples above with zero manual generic arguments — the DX contract, run in
   CI.
5. **Error-message quality pass:** the most likely developer mistakes (unknown
   include path, non-allowlisted filter field, disabled operation call, missing
   adapter registration) each produce an error that names the fix.
6. A naming-consistency audit of the whole public surface against the Naming
   Conventions section — the last cheap moment to rename anything.

**Constraints:** The zero-config path must stay genuinely zero-config; every
feature here must be additive, never a tax on the simple case.

---

## PHASE 17 — REFERENCE APPLICATION

**Depends on:** Phases 12, 16 (and exercises everything before them).

**Goal:** One realistic application that uses every shipped feature, living in
`packages/examples/`, grown from the Milestone B checkpoint app, serving as
both living documentation and the `@crudo/nest` e2e bed.

**Domain (chosen to force the features):** a project-management API — `User`,
`Project`, `Task`, `Comment`, `Tag`. It must exercise: nested includes ≥ 2
deep (`project.tasks.comments`), sparse fieldsets on includes, relation-path
filtering, soft delete + restore on `Task`, a custom operation
(`POST /tasks/:id/complete`), a bulk atomic operation (Phase 14), and global
config with per-entity overrides.

**Deliverables:**

1. The reference app, runnable with one command (containerized DB), seeded.
2. E2E test suite over its generated routes.
3. A feature-coverage matrix: every phase's headline feature → where the
   reference app exercises it (gaps here are undone work).

**Constraints:** The app consumes only public APIs — if it needs a deep import,
that's an API-surface bug (Phase 2). No feature may be demonstrated with
pseudo-code; it runs or it's not in the app.

---

## PHASE 18 — NPM PUBLISHING & RELEASE ENGINEERING

**Depends on:** Phase 2, Phase 17 — and effectively everything else; this is
the shipping phase.

**Goal:** Take the finished monorepo (`@crudo/core`, `@crudo/typeorm`,
`@crudo/nest`) and ship it to npm in a way that's maintainable long-term, not
just publishable once.

**Deliverables:**

1. **Build output:** dual ESM + CJS builds per package, with a correct
   `exports` map and shipped `.d.ts` declarations; the known dual-package
   pitfalls (default-export interop, `instanceof` across module instances —
   which matters for the Phase 6 exception hierarchy) addressed explicitly;
   confirm tree-shakability for consumers who only import `@crudo/core`.
2. **Dependency classification:** `typeorm` and `@nestjs/*` as
   `peerDependencies` on their respective adapter packages, never on
   `@crudo/core`; regular `dependencies` kept minimal everywhere; supported
   Node and peer version ranges stated and CI-tested as a matrix.
3. **API surface gating:** api-extractor (or equivalent) generates a public API
   report per package; an unapproved API-report diff fails CI — the public
   surface only changes on purpose.
4. **Versioning & release automation:** changesets-based workflow, publish
   order derived from the Phase 2 dependency graph (core → typeorm → nest), so
   a core-breaking change can't accidentally ship before dependents catch up;
   a canary/prerelease channel (`next` tag).
5. **Provenance & supply-chain:** npm provenance/attestation on publish,
   lockfile-based CI installs, dependency audit as a release gate.
6. **Semver & deprecation policy:** what counts as breaking (adding a required
   method to `RepositoryAdapter`, renaming a Phase 6 error code, changing a
   Phase 8 default); pre-1.0 vs. post-1.0 stability commitments, stated
   explicitly. Milestone B may ship as `0.x` so real feedback arrives before
   the C features harden.
7. **Docs generation:** API reference generated from the Phase 3/4 interfaces
   (e.g. via TypeDoc) and the Phase 5 grammar document, published together per
   release so reference and grammar never drift from the shipped types.

**Constraints:** No manual publish steps for routine releases — the pipeline
should be the only path to npm.
