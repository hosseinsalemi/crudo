# @crudo/core

Framework- and ORM-independent contracts and type system for Crudo.

**Zero runtime dependencies** — this package must not depend on NestJS or
TypeORM, directly or transitively (enforced by `.dependency-cruiser.cjs`).
In Milestone A it contains types only; runtime code (engine, config
resolution, query parsing) lands in Milestone B.

## Layout

```
src/
├─ types/          EntityId, FieldPath, shared type utilities
├─ query/          Filter AST, pagination, sort, field selection, contexts
├─ dto/            DTO slots, list envelope, bulk envelope
├─ errors/         CrudException, error codes, problem details
├─ config/         Settings schema, global/entity config, resolved config
├─ operations/     Operation ids, handler contract, registry
├─ relations/      Relation registry, include tree/resolver (Phase 16 contracts)
├─ context/        CrudContext, CrudRequest, CrudResponse
├─ serialization/  Serializer, Deserializer
├─ persistence/    EntityReader/Writer, RepositoryAdapter, transactions
├─ service/        CrudService, per-call options
└─ index.ts        Explicit named barrel — the public API surface
```

Only the barrel (`@crudo/core`) is public API; deep imports are not.

See `packages/docs/architecture/03-core-contracts-and-type-system.md` for
the generic-parameter table, `FieldPath` notes, and the module-augmentation
pattern for `OperationMetadata`.
