# 03 — Core Contracts & Type System (Phase 3)

All contracts live in `packages/core/src` and are exported through the
explicit barrel. **Types only** — no classes, no implementations; the
first runtime code lands in Milestone B. Contracts whose implementations
land in Milestone C (relations, transactions, bulk, operation control) are
declared now so later phases never mutate `@crudo/core` types.

## 1. Generic parameters

| Parameter    | Purpose                                                        | Default                                                                                                          | Override example                                      |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `TEntity`    | The ORM-mapped entity class everything is typed against        | — (always inferred from `createCrud(Entity)`)                                                                    | `CrudService<User>`                                   |
| `TId`        | Primary-key type; appears in `findOne(id)`, `deleteOne(id)`, … | `EntityId` (`string \| number`)                                                                                  | `CrudService<User, string>` for UUID keys             |
| `TCreateDto` | `POST` request body                                            | `EntityInput<TEntity>` (entity minus methods; runtime derivation also drops generated/relation fields — Phase 4) | `dto: { create: CreateUserDto }`                      |
| `TUpdateDto` | `PUT` full-replace body                                        | `EntityInput<TEntity>`                                                                                           | `dto: { update: UpdateUserDto }`                      |
| `TPatchDto`  | `PATCH` partial body                                           | `Partial<TUpdateDto>` — follows `update` when that is overridden                                                 | `dto: { patch: PatchUserDto }`                        |
| `TQueryDto`  | `GET` list query shape                                         | `QueryContext<TEntity>`                                                                                          | `dto: { query: UserQueryDto }`                        |
| `TItemDto`   | Any single-resource response                                   | `TEntity`                                                                                                        | `dto: { item: UserItemDto }`                          |
| `TListDto`   | Element type inside `ListResultDto.items`                      | `TItemDto` (follows `item`)                                                                                      | `dto: { list: UserListDto }` — leaner list projection |

Design rule: **every parameter defaults from the ones before it**, so type
inference is a feature — a consumer rarely writes a generic argument by
hand. `createCrud(UserEntity)` yields a fully typed service with zero
manual arguments; registering a DTO class narrows exactly one slot and
everything downstream (envelope, service returns) follows.

The chain `TEntity → TUpdateDto → TPatchDto` and `TItemDto → TListDto`
mirrors the Phase 4 runtime resolution rules, so static defaults and
runtime derivation never disagree about _which slot follows which_.

## 2. `FieldPath` implementation notes

`FieldPath<TEntity, TMaxDepth = 3>` (`types/field-path.ts`) produces the
union of dot-paths into an entity — `'name' | 'profile.city' |
'posts.comments.text'` — used by filter, sort, and selection typings so
relation paths are spell-checked at compile time.

- **Recursion cap:** default depth 3, hard maximum 5 (`FieldPathDepth`),
  decremented through a tuple table (`Prev`). The cap exists because the
  union grows combinatorially with depth — entities with many relations
  would otherwise produce unions large enough to slow or crash the
  compiler (ADR-0008).
- **`any` / `unknown`:** degrade to `string` (detected via the `0 extends
1 & T` probe) — untyped entities get no spell-checking but stay usable;
  the runtime allowlist remains the actual gate.
- **Index signatures:** `string extends keyof T` → degrade to `string`;
  keys are unknowable.
- **Methods** are excluded (`Function`-valued properties map to `never`).
- **Arrays** traverse through their element type: a path into a to-many
  relation (`posts.comments`) reads identically to a to-one.
- **`Date`, `bigint`, primitives** are leaves — no recursion into their
  methods.
- `FieldPath` is a _typing aid_, not a security boundary: the Phase 5
  allowlists decide what a request may actually do.

## 3. Module augmentation of `OperationMetadata`

`OperationMetadata` is an intentionally empty interface on every
operation registry entry. Core stores it, merges it per Phase 8
precedence, and hands it to the framework layer — it never reads it. A
consumer types its keys via declaration merging; `@crudo/nest` declares a
`routes` key:

```ts
// packages/frameworks/nest/src/augmentation.ts (Phase 11)
import type { OperationMetadata } from "@crudo/core";

declare module "@crudo/core" {
  interface OperationMetadata {
    routes?: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path?: string;
      /** `false` = service-only operation: callable in code, no route. */
      enabled?: boolean;
      swagger?: Record<string, unknown>;
    };
  }
}
```

With that augmentation in a consumer's compilation, this type-checks
end-to-end while core remains route-ignorant:

```ts
createCrud(UserEntity, {
  operations: {
    findMany: { meta: { routes: { path: "search" } } },
  },
});
```

This pattern requires a stable augmentation target — one reason the barrel
is an explicit named list (ADR-0010) and the `exports` map exposes exactly
one module id, `@crudo/core`.

## 4. Why zero runtime dependencies (ADR-0005)

`@crudo/core` is imported by every Crudo package and every consumer app.
Any dependency it carried would be forced on all of them — version
conflicts, install weight, supply-chain surface — and utility libraries in
particular tend to leak types into public signatures, making third-party
types part of Crudo's API contract. Framework/ORM independence is the same
rule at its extreme: core not importing TypeORM or NestJS (directly or
transitively) is what makes the adapter seam real rather than aspirational.
Enforced by dependency-cruiser (`core-imports-nothing`), not convention.

## 5. Contract inventory

| Area          | Contracts                                                                                                                                                              | Implemented in                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Service       | `CrudService`, `CrudCallOptions`, `IdentifiedInput`                                                                                                                    | Phase 7                            |
| Persistence   | `EntityReader`, `EntityWriter`, `RepositoryAdapter`                                                                                                                    | Phases 9–10                        |
| Transactions  | `TransactionManager`, `TransactionContext`, `TransactionOptions`                                                                                                       | Phases 9–10 (adapter-level hook)   |
| Query         | `Filter*`, `FilterExpression`, `Sort`, `Pagination`, `PaginationStrategy`, `FieldSelection`, `QueryContext`, `NormalizedQueryContext`, `FilterParser`, `FilterBuilder` | Phase 5 (parse), Phase 10 (build)  |
| DTO           | `Dto`, `DtoClass`, `OperationDtoMap`, `DtoResolver`, `ListResultDto`, `ListMetaDto`, `BulkResultDto`                                                                   | Phase 4 (bulk reserved)            |
| Errors        | `CrudException`, `CrudoErrorCode`, `ErrorHandler`, `ProblemDetailsDto`                                                                                                 | Phase 6                            |
| Config        | `CrudoSettings` (+ per-area settings), `GlobalConfig`, `EntityConfig`, `OperationConfig`, `CustomOperationConfig`, `ResolvedEntityConfig`                              | Phase 8 (operations Phase 13)      |
| Operations    | `OperationId`, `OperationHandler`, `OperationMetadata`, `OperationDescriptor`, `OperationRegistry`                                                                     | Phase 7 (control surface Phase 13) |
| Relations     | `RelationDescriptor`, `RelationRegistry`, `IncludeTree`, `IncludeNode`, `IncludeResolver`                                                                              | Phase 15                           |
| Context       | `CrudContext`, `CrudContextState`, `StateKey`, `CrudRequest`, `CrudResponse`                                                                                           | Phase 7                            |
| Serialization | `Serializer`, `Deserializer`                                                                                                                                           | Phase 7                            |
