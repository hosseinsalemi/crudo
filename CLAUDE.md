# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Crudo is

A production-grade CRUD framework for TypeScript: define an entity once (via TypeORM) and get the full REST CRUD surface — filtering, sorting, pagination, nested includes, field selection, optional per-operation DTOs, transactions, and problem-details errors — behind generated NestJS routes, configurable at global → entity → operation → per-call scope.

Crudo is built phase-by-phase from [`crudo-phases-v6.md`](crudo-phases-v6.md), which is the **authoritative spec**. Its "Naming Conventions (normative)" section governs all names — deviations are review findings. When implementing or extending, consult the relevant phase there rather than inventing behavior.

## Commands

```bash
pnpm install
pnpm check        # the full gate: build + depcruise + test (run before considering work done)
pnpm build        # tsc -b (project references across the workspace)
pnpm test         # vitest run (whole monorepo)
pnpm depcruise    # enforce package-boundary rules (.dependency-cruiser.cjs)
pnpm prettify     # prettier --write . (printWidth 120)
```

Run a single test file or test by name:

```bash
pnpm vitest run packages/core/tests/query/filter-parser.spec.ts
pnpm vitest run -t "coerces numeric ids"
```

Tests live in each package's `tests/` directory (never in `src/`, so they are not shipped in `dist/`). Vitest aliases `@crudo/*` to package `src/` directly (see `vitest.config.ts`), so tests exercise sources with no stale-`dist` hazard. The SWC vitest plugin is required — TypeORM entities and Nest DI need decorator metadata that esbuild cannot emit.

## Architecture

Three packages in a strict hub-and-spoke topology (`pnpm-workspace.yaml`):

```
@crudo/nest ──▶ @crudo/core ◀── @crudo/typeorm
```

- **`@crudo/core`** (`packages/core`) — all contracts, the type system, and the request engine. **Zero runtime dependencies** and imports nothing (ADR-0005). It has no knowledge of TypeORM or Nest.
- **`@crudo/typeorm`** (`packages/orms/typeorm`) — implements core's `RepositoryAdapter` and feeds core's entity-metadata seam from TypeORM metadata. `typeorm` is a peer dependency.
- **`@crudo/nest`** (`packages/frameworks/nest`) — the `@Crud` decorator and NestJS route generation.

These boundaries are **mechanically enforced** by `.dependency-cruiser.cjs`, not just convention: core may import nothing, adapters and framework bindings import the `@crudo/core` barrel only (no deep imports), and the adapter never imports the framework or vice versa — they meet only through Nest's DI container. An illegal import fails `pnpm depcruise` (part of `pnpm check`), not code review.

### The request pipeline (the spine)

`CrudEngine.execute` (`packages/core/src/engine/crud-engine.ts`) is a Template Method over one lifecycle, and nearly every stage is a swappable seam:

```
operation resolution → config resolution → DTO resolution → deserialization →
query resolution (reads) → handler execution → response mapping → serialization
```

Nothing is special-cased per verb. Operations come from an **operation registry** (`createOperationRegistry`), and the engine loops over registry entries — this is why adding an operation is adding a registry entry, and why the same registry drives both the engine and route generation. Handlers, serializer/deserializer, query normalizer, pagination strategies, and error handler are all constructor-injected.

### Composition root

`createCrudo(options).createCrud(Entity, config?, runtime?)` (`packages/core/src/crudo.ts`) is the **only** way entities enter the system. All resolution (config precedence merge, DTO derivation, registry construction) happens at that call — bootstrap — and the result is frozen after. Core needs an explicit `infrastructure` (adapter + metadata); `@crudo/typeorm`'s `createTypeOrmInfrastructure(dataSource)` / `createTypeOrmCrudo` is the sugar that derives both from a `DataSource`.

### Route generation is registry-driven and happens at decoration time

`@Crud(Entity, config?)` (`packages/frameworks/nest/src/crud.decorator.ts`) builds the same operation registry the engine uses and generates one route per **enabled** entry at class-definition time (the only moment Nest's router scan can see the methods). Notable rules:

- Disabled operations get no route; custom operations get their route from `meta.routes`; `meta.routes.enabled: false` keeps an operation service-only.
- **Manual-method-wins**: a hand-written controller method whose name matches an operation id suppresses that generated route.
- The bound service arrives later via property injection (`forFeature` provider), not through the constructor.

Standard operations delegate to the typed `DefaultCrudService` surface; custom operations go through `service.engine.execute(...)` — one pipeline either way. HTTP query strings arrive as flat bracket keys wrapped in a `WireQuery` marker so the full parse-and-coerce pipeline runs; programmatic callers pass a typed `QueryContext` (normalized without coercion).

### Wiring an app

See `packages/examples/src/app.module.ts`: `CrudoModule.forRootAsync({ useFactory: () => ({ infrastructure: createTypeOrmInfrastructure(dataSource), defaults: {...} }) })` supplies the global scope, and `CrudoModule.forFeature([...Controllers])` registers the `@Crud` controllers. The app is what hands Nest its infrastructure — the packages never import each other.

## Conventions (from the spec's normative section)

- **DTO slots** are bare verbs: `create`, `update`, `patch`, `query`, `item`, `list` (because `createOne`/`createMany` share the `create` DTO).
- **DTO classes**: request bodies are `<Verb><Entity>Dto` (`CreateUserDto`); query/response shapes are `<Entity><Slot>Dto` (`UserItemDto`, `UserListDto`). Every wire-crossing shape carries the `Dto` suffix; behavioral contracts (services, adapters, registries) never do.
- **Operations** are camelCase and always name cardinality: `<verb>One` / `<verb>Many`. "Bulk" is the feature term (config key `bulk`, `/bulk` routes, `BulkResultDto`), never a method prefix.
- **Filter operators**: AST enum in `SCREAMING_SNAKE` (`EQ`…`IS_NOT_NULL`); wire tokens in camelCase (`eq`…`isNotNull`), exact-case matched. Phase 5's mapping table is the single source of truth.
- **Exceptions**: `*Exception` classes with stable `CRUDO_SNAKE_CASE` codes.
- **Config keys**: camelCase, booleans phrased positively (`exposeInternals`, never `hideInternals`).
- **No `I` prefix** on interfaces.
- The core barrel (`packages/core/src/index.ts`) is a **deliberate explicit named list** (no `export *`) — the public surface changes only on purpose. Add exports there intentionally.

## Where to read more

`packages/docs/` holds the design docs, `glossary.md`, and ADRs (`adr/0001`…`0013`) — one ADR per load-bearing decision. `packages/docs/architecture/` mirrors the packages (query grammar, error handling, engine, TypeORM adapter, Nest integration, soft delete). ADRs are referenced by name in code comments; read the referenced ADR before changing the behavior it governs.
