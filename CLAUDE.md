# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Kavo is

A production-grade CRUD framework for TypeScript: define an entity once (via TypeORM) and get the full REST CRUD surface — filtering, sorting, pagination, nested includes, field selection, optional per-operation DTOs, transactions, and problem-details errors — behind generated NestJS routes, configurable at global → entity → operation → per-call scope.

The authoritative sources are `packages/docs/` (architecture notes and ADRs) and the **Conventions** section below, which is normative — naming deviations are review findings. Consult the governing ADR before changing behavior it covers, rather than inventing behavior.

Kavo was originally built from a phased plan (`kavo-phases-v6.md`), now retired. `Phase N` references survive in code comments and docs as historical provenance; the remaining unbuilt work lives in [`packages/docs/roadmap.md`](packages/docs/roadmap.md).

## Commands

```bash
pnpm install
pnpm check        # the full gate: build + typecheck + depcruise + test (run before considering work done)
pnpm build        # tsc -b (project references across the workspace — src only)
pnpm typecheck    # tsc --noEmit over each package's tests/ (tsconfig.tests.json)
pnpm test         # vitest run (whole monorepo)
pnpm depcruise    # enforce package-boundary rules (.dependency-cruiser.cjs)
pnpm prettify     # prettier --write . (printWidth 120)
```

Run a single test file or test by name:

```bash
pnpm vitest run packages/core/tests/filter-parser.spec.ts
pnpm vitest run -t "coerces numeric ids"
```

Tests live in each package's `tests/` directory (never in `src/`, so they are not shipped in `dist/`). Vitest aliases `@kavo/*` to package `src/` directly (see `vitest.config.ts`), so tests exercise sources with no stale-`dist` hazard. The SWC vitest plugin is required — TypeORM entities and Nest DI need decorator metadata that esbuild cannot emit.

Because the build compiles `src` only, each package also has a `tsconfig.tests.json` (`noEmit`, `include: ["tests"]`, `paths` mirroring the vitest aliases) that `pnpm typecheck` runs. That is what makes the type-level acceptance tests in `packages/*/tests/types/*.test-d.ts` real: they end in `.test-d.ts`, so vitest never collects them and nothing executes — `expectTypeOf` assertions and `@ts-expect-error` directives are checked by `tsc` alone. An unused `@ts-expect-error` is itself an error, so those tests fail in both directions.

## Architecture

Three packages in a strict hub-and-spoke topology (`pnpm-workspace.yaml`):

```
@kavo/nest ──▶ @kavo/core ◀── @kavo/typeorm
```

- **`@kavo/core`** (`packages/core`) — all contracts, the type system, and the request engine. **Zero runtime dependencies** and imports nothing (ADR-0005). It has no knowledge of TypeORM or Nest.
- **`@kavo/typeorm`** (`packages/orms/typeorm`) — implements core's `RepositoryAdapter` and feeds core's entity-metadata seam from TypeORM metadata. `typeorm` is a peer dependency.
- **`@kavo/nest`** (`packages/frameworks/nest`) — the `@Crud` decorator and NestJS route generation.

These boundaries are **mechanically enforced** by `.dependency-cruiser.cjs`, not just convention: core may import nothing, adapters and framework bindings import the `@kavo/core` barrel only (no deep imports), and the adapter never imports the framework or vice versa — they meet only through Nest's DI container. An illegal import fails `pnpm depcruise` (part of `pnpm check`), not code review.

### The request pipeline (the spine)

`CrudEngine.execute` (`packages/core/src/engine/crud-engine.ts`) is a Template Method over one lifecycle, and nearly every stage is a swappable seam:

```
operation resolution → config resolution → DTO resolution → deserialization →
query resolution (reads) → handler execution → response mapping → serialization
```

Nothing is special-cased per verb. Operations come from an **operation registry** (`createOperationRegistry`), and the engine loops over registry entries — this is why adding an operation is adding a registry entry, and why the same registry drives both the engine and route generation. Handlers, serializer/deserializer, query normalizer, pagination strategies, and error handler are all constructor-injected.

### Composition root

`createKavo(options).createCrud(Entity, config?, runtime?)` (`packages/core/src/kavo.ts`) is the **only** way entities enter the system. All resolution (config precedence merge, DTO derivation, registry construction) happens at that call — bootstrap — and the result is frozen after. Core needs an explicit `infrastructure` (adapter + metadata); `@kavo/typeorm`'s `createTypeOrmInfrastructure(dataSource)` / `createTypeOrmKavo` is the sugar that derives both from a `DataSource`.

### Route generation is registry-driven and happens at decoration time

`@Crud(Entity, config?)` (`packages/frameworks/nest/src/crud.decorator.ts`) builds the same operation registry the engine uses and generates one route per **enabled** entry at class-definition time (the only moment Nest's router scan can see the methods). Notable rules:

- Disabled operations get no route; custom operations get their route from `meta.routes`; `meta.routes.enabled: false` keeps an operation service-only.
- **Manual-method-wins**: a hand-written controller method whose name matches an operation id suppresses that generated route.
- The bound service arrives later via property injection (`forFeature` provider), not through the constructor.

Standard operations delegate to the typed `DefaultCrudService` surface; custom operations go through `service.engine.execute(...)` — one pipeline either way. HTTP query strings arrive as flat bracket keys wrapped in a `WireQuery` marker so the full parse-and-coerce pipeline runs; programmatic callers pass a typed `QueryContext` (normalized without coercion).

### Wiring an app

See `packages/examples/src/app.module.ts`: `KavoModule.forRootAsync({ useFactory: () => ({ infrastructure: createTypeOrmInfrastructure(dataSource), defaults: {...} }) })` supplies the global scope, and `KavoModule.forFeature([...Controllers])` registers the `@Crud` controllers. The app is what hands Nest its infrastructure — the packages never import each other.

## Conventions (normative)

- **DTO slots** are bare verbs: `create`, `update`, `patch`, `query`, `item`, `list` (because `createOne`/`createMany` share the `create` DTO).
- **DTO classes**: request bodies are `<Verb><Entity>Dto` (`CreateUserDto`); query/response shapes are `<Entity><Slot>Dto` (`UserItemDto`, `UserListDto`). Every wire-crossing shape carries the `Dto` suffix; behavioral contracts (services, adapters, registries) never do.
- **Operations** are camelCase and always name cardinality: `<verb>One` / `<verb>Many`. "Bulk" is the feature term (config key `bulk`, `/bulk` routes, `BulkResultDto`), never a method prefix.
- **Filter operators**: AST enum in `SCREAMING_SNAKE` (`EQ`…`IS_NOT_NULL`); wire tokens in camelCase (`eq`…`isNotNull`), exact-case matched. The mapping table in `packages/docs/architecture/05-query-grammar.md` is the single source of truth.
- **Envelope fields**: `items`, `limit`, `offset`, `total`, `meta` — the default pagination wire params use the same `limit`/`offset` names, so request and response mirror each other.
- **Factories** are `create*` (`createKavo`, `createCrud`). **Data access**: `EntityReader` (reads) + `EntityWriter` (writes); `RepositoryAdapter` is both, and adapters are named for what they adapt (`TypeOrmRepositoryAdapter`).
- **Exceptions**: `*Exception` classes with stable `KAVO_SNAKE_CASE` codes.
- **Config keys**: camelCase, booleans phrased positively (`exposeInternals`, never `hideInternals`).
- **No `I` prefix** on interfaces.
- The core barrel (`packages/core/src/index.ts`) is a **deliberate explicit named list** (no `export *`) — the public surface changes only on purpose. Add exports there intentionally.

## The development workflow

Work moves one issue at a time, on one branch, through slash commands in `.claude/commands/`:

```
/issue "rough idea"   →  a plannable GitHub issue (acceptance criteria, affected packages, constraints)
/next [n]             →  kavo-architect plans it  →  YOU APPROVE  →  branch created off main
/implement            →  code + tests written here, in the main thread  →  pnpm check  →  commit
/review               →  kavo-reviewer ‖ kavo-boundary-guard ‖ kavo-test-auditor, consolidated
/ship                 →  pnpm check  →  push  →  PR opened, "Closes #n"
/merge                →  CI verified  →  squash merge  →  branch deleted  →  back on green main
```

`/commit` splits the working tree into logical commits at any point.

Two rules make this work:

- **Planning and review are delegated; implementation is not.** The four agents in `.claude/agents/` are all read-only. Planning benefits from a cold, focused read of the issue, and review benefits from independent fresh eyes — but implementation needs the conversation's full context, so it happens in the main thread.
- **`pnpm check` is the gate, and it is never worked around.** `/implement`, `/ship`, and `/merge` each run it and report the real result. A red gate is not shipped, and a test is never weakened to make it pass.

## Where to read more

`packages/docs/` holds the design docs, `glossary.md`, and ADRs (`adr/0001`…`0014`) — one ADR per load-bearing decision. `packages/docs/architecture/` mirrors the packages (query grammar, error handling, engine, TypeORM adapter, Nest integration, soft delete, relations). ADRs are referenced by name in code comments; read the referenced ADR before changing the behavior it governs.
