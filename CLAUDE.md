# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Kavo is

A production-grade CRUD framework for TypeScript: define an entity once (via TypeORM, Prisma, or Mongoose) and get the full REST CRUD surface — filtering, sorting, pagination, nested includes, field selection, optional per-operation DTOs, transactions, and problem-details errors — behind generated NestJS routes, configurable at global → entity → operation → per-call scope.

The authoritative sources are `docs/` (architecture notes and ADRs) and the **Conventions** section below, which is normative — naming deviations are review findings. Consult the governing ADR before changing behavior it covers, rather than inventing behavior.

## Commands

```bash
pnpm install
pnpm check        # the full gate: build + typecheck + depcruise + lint + test (run before considering work done)
pnpm build        # tsc -b (project references across the workspace — src only)
pnpm typecheck    # tsc --noEmit over each package's tests/ (tsconfig.tests.json)
pnpm test         # vitest run (whole monorepo)
pnpm depcruise    # enforce package-boundary rules (.dependency-cruiser.cjs)
pnpm lint         # oxlint over packages/*/src and packages/*/tests
pnpm prettify     # prettier --write . (printWidth 120)
pnpm docs:links   # every `docs/**.md` reference in a tracked file resolves (own CI job, not in `check`)
```

Run a single test file or test by name:

```bash
pnpm vitest run packages/core/tests/filter-parser.spec.ts
pnpm vitest run -t "coerces JavaScript number syntax"
```

Tests live in each package's `tests/` directory (never in `src/`, so they are not shipped in `dist/`). Vitest aliases `@kavo/*` to package `src/` directly (see `vitest.config.ts`), so tests exercise sources with no stale-`dist` hazard. The SWC vitest plugin is required — TypeORM entities and Nest DI need decorator metadata that esbuild cannot emit.

Because the build compiles `src` only, each package also has a `tsconfig.tests.json` (`noEmit`, `include: ["tests"]`, `paths` mirroring the vitest aliases) that `pnpm typecheck` runs. That is what makes the type-level acceptance tests in `packages/*/tests/types/*.test-d.ts` real: they end in `.test-d.ts`, so vitest never collects them and nothing executes — `expectTypeOf` assertions and `@ts-expect-error` directives are checked by `tsc` alone. An unused `@ts-expect-error` is itself an error, so those tests fail in both directions.

## Architecture

Five packages in a strict hub-and-spoke topology (`pnpm-workspace.yaml`):

```
@kavo/nest ──▶ @kavo/core ◀── @kavo/typeorm
                 ▲  ▲  ▲
                 │  │  └───── @kavo/prisma
       @kavo/graphql  └────── @kavo/mongoose
```

- **`@kavo/core`** (`packages/core`) — all contracts, the type system, and the request engine. **Zero runtime dependencies** and imports nothing (ADR-0005). It has no knowledge of TypeORM or Nest.
- **`@kavo/typeorm`** (`packages/orms/typeorm`) — implements core's `RepositoryAdapter` and feeds core's entity-metadata seam from TypeORM metadata. `typeorm` is a peer dependency.
- **`@kavo/prisma`** (`packages/orms/prisma`) — the same seams over a Prisma Client delegate, fed from Prisma's DMMF. Needs caller-declared marker classes as entity identities (ADR-0017). `@prisma/client` is a peer dependency.
- **`@kavo/mongoose`** (`packages/orms/mongoose`) — the same seams over a Mongoose model, fed from `schema.paths`. A Mongoose model _is_ the entity identity, so nothing is declared twice, and `ObjectId` converts to a hex string at the adapter boundary (ADR-0018). `mongoose` is a peer dependency.
- **`@kavo/nest`** (`packages/frameworks/nest`) — the `@Kavo` decorator and NestJS route generation.
- **`@kavo/graphql`** (`packages/protocols/graphql`) — host-framework-agnostic GraphQL schema binding: builds a schema over a `createCrud` service, delegating every resolver to the same engine REST uses. Depends only on `@kavo/core` and the `graphql` peer, never on `@kavo/nest` — the `frameworks/* → protocols/*` edge is one-directional (ADR-0016). `@kavo/nest` is the side that imports it, to provide `BaseKavoGraphQLController`; it does so through a lazy `import("@kavo/graphql")` so the peer stays genuinely optional.

These boundaries are **mechanically enforced** by `.dependency-cruiser.cjs`, not just convention: core may import nothing, adapters/protocol bindings/framework bindings import the `@kavo/core` barrel only (no deep imports), and spokes never import each other directly — they meet only through Nest's DI container. An illegal import fails `pnpm depcruise` (part of `pnpm check`), not code review.

### The request pipeline (the spine)

`KavoEngine.execute` (`packages/core/src/engine/kavo-engine.ts`) is a Template Method over one lifecycle, and nearly every stage is a swappable seam:

```
operation resolution → config resolution → DTO resolution → deserialization →
query resolution (reads) → handler execution → response mapping → serialization
```

Nothing is special-cased per verb. Operations come from an **operation registry** (`createOperationRegistry`), and the engine loops over registry entries — this is why adding an operation is adding a registry entry, and why the same registry drives both the engine and route generation. Handlers, serializer/deserializer, query normalizer, pagination strategies, and error handler are all constructor-injected.

### Composition root

`createKavo(options).createCrud(Entity, config?, runtime?)` (`packages/core/src/kavo.ts`) is the **only** way entities enter the system. All resolution (config precedence merge, DTO derivation, registry construction) happens at that call — bootstrap — and the result is frozen after. Core needs an explicit `infrastructure` (adapter + metadata); `@kavo/typeorm`'s `createInfrastructure(dataSource)` / `createTypeOrmKavo` is the sugar that derives both from a `DataSource`.

### Route generation is registry-driven and happens at decoration time

`@Kavo(Entity, config?)` (`packages/frameworks/nest/src/kavo.decorator.ts`) builds the same operation registry the engine uses and generates one route per **enabled** entry at class-definition time (the only moment Nest's router scan can see the methods). Notable rules:

- Disabled operations get no route; custom operations get their route from `meta.routes`; `meta.routes.enabled: false` keeps an operation service-only.
- **Manual-method-wins**: a hand-written controller method whose name matches an operation id suppresses that generated route.
- The bound service arrives later via property injection (`forFeature` provider), not through the constructor.

Standard operations delegate to the typed `DefaultKavoService` surface; custom operations go through `service.engine.execute(...)` — one pipeline either way. HTTP query strings arrive as flat bracket keys wrapped in a `WireQuery` marker so the full parse-and-coerce pipeline runs; programmatic callers pass a typed `QueryContext` (normalized without coercion).

### Wiring an app

See `examples/nest-typeorm/src/app.module.ts`: `KavoModule.forRootAsync({ provideServices: true, useFactory: () => ({ infrastructure: createInfrastructure(dataSource), defaults: {...} }) })` is the app's only Kavo import — the `@Kavo` controllers just go in `AppModule`'s own `controllers: [...]` array. `KavoModule`'s discovery binder (`DiscoveryService`, `onModuleInit`) finds them there and binds each entity's service, no registration needed; `provideServices: true` additionally provides `getKavoServiceToken(Entity)` as a real DI provider for every `@Kavo`-decorated class the process has seen, which `AddressController` needs for its constructor-injected `base` (a fully custom route wants it typed as an ordinary constructor param). That's the same thing the standalone no-arg `KavoModule.forFeature()` does, folded into one call; `forFeature([...])` with an explicit array also still exists. Both no-arg forms are process-wide, so `@kavo/nest`'s own tests (many differently-configured `@Kavo` classes over one entity in one file) always pass `forFeature` an explicit array instead. The app is what hands Nest its infrastructure — the packages never import each other.

## Conventions (normative)

- **DTO slots** are bare verbs: `create`, `update`, `patch`, `query`, `item`, `list` (because `createOne`/`createMany` share the `create` DTO).
- **DTO classes**: request bodies are `<Verb><Entity>Dto` (`CreateUserDto`); query/response shapes are `<Entity><Slot>Dto` (`UserItemDto`, `UserListDto`). Every wire-crossing shape carries the `Dto` suffix; behavioral contracts (services, adapters, registries) never do.
- **Operations** are camelCase and always name cardinality: `<verb>One` / `<verb>Many`. "Bulk" is the feature term (config key `bulk`, `/bulk` routes, `BulkResultDto`), never a method prefix.
- **Filter operators**: AST enum in `SCREAMING_SNAKE` (`EQ`…`IS_NOT_NULL`); wire tokens in camelCase (`eq`…`isNotNull`), exact-case matched. The mapping table in `docs/internals/architecture/05-query-grammar.md` is the single source of truth.
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
/implement <n>        →  branch created off main  →  code + tests written directly, in the main thread
                          →  left uncommitted
/review               →  pnpm check ‖ the reviewer fan-out (see below), consolidated  →  local mode
/commit               →  working tree split into logical commits
/pr                   →  pnpm check  →  push  →  PR opened/updated, "Closes #n"
/review [pr#]         →  same reviewer fan-out, run against the open PR  →  PR mode
/merge                →  CI + /review verified  →  squash merge  →  branch deleted  →  back on green main
```

`/commit` splits the working tree into logical commits at any point. `/review`
gates a change **before** it's committed when there's uncommitted work (local
mode), and re-runs the same reviewer fan-out **after** it's pushed, against
the actual PR (PR mode) — use it any time on any open PR, not just the one
you just opened. The fan-out itself (`kavo-reviewer`, `kavo-test-auditor`,
`kavo-security-auditor`, `kavo-perf-auditor`) is defined in
`.claude/commands/review.md`, which only runs the security and perf auditors
when the diff touches their area — read it there rather than here, so this
file doesn't drift when the fan-out changes.

`/list` and `/view <n>` read existing GitHub issues without changing anything; `/publish` bumps and tags a release once `main` is green — neither is part of the per-issue loop above.

Two rules make this work:

- **Review is delegated; implementation is not.** Every agent in `.claude/agents/` — the four review auditors above — is read-only. Review benefits from independent fresh eyes, but implementation needs the conversation's full context (the issue, the seams it touches, decisions made along the way), so `/implement` reads the issue and writes the code in the main thread directly, with no separate planning hand-off.
- **`pnpm check` is the gate, and it is never worked around.** `/implement`, `/review`, `/pr`, and `/merge` each run it and report the real result. A red gate is not shipped, and a test is never weakened to make it pass.

## Where to read more

`docs/getting-started.md`, `docs/using-the-api.md`, and `docs/integrations/nest/` (per-ORM wiring plus the full `@Kavo`/`KavoModule` configuration reference) are the adopter-facing front door; `docs/internals/` holds the design docs and ADRs (`adr/0001`…`0018`) — one ADR per load-bearing decision. `docs/internals/architecture/` mirrors the packages (query grammar, error handling, engine, TypeORM adapter, Nest integration, soft delete, relations). ADRs are referenced by name in code comments; read the referenced ADR before changing the behavior it governs.
