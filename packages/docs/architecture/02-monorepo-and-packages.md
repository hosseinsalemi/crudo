# 02 — Monorepo & Package Design (Phase 2)

## 1. Structure

```
crudo/
├─ package.json               # root: build/check scripts, dev tooling
├─ pnpm-workspace.yaml
├─ tsconfig.base.json         # shared strict compiler options
├─ tsconfig.json              # solution file: project-reference graph
├─ .dependency-cruiser.cjs    # mechanical boundary enforcement
└─ packages/
   ├─ core/                   # @crudo/core
   │  ├─ src/{types,query,dto,errors,config,operations,
   │  │       relations,context,serialization,persistence,service}/
   │  └─ src/index.ts         # explicit named barrel
   ├─ orms/
   │  └─ typeorm/             # @crudo/typeorm (scaffold until Phase 10)
   │     └─ src/index.ts
   ├─ frameworks/
   │  └─ nest/                # @crudo/nest (scaffold until Phase 12)
   │     └─ src/index.ts
   ├─ examples/               # Phase 17 reference application (empty)
   └─ docs/                   # this documentation
```

The `orms/` and `frameworks/` parent folders keep the door open for future
adapters (Prisma, Express, …) without implying any get built — v6 ships
exactly three packages.

## 2. Responsibility statements

- **`@crudo/core`** exists to own every contract and all ORM/framework-
  independent runtime (engine, config merging, query parsing, DTO
  resolution, exceptions). It can't depend on **anything** — not TypeORM,
  not NestJS, not utility libraries. If core needs a helper, core writes it.
- **`@crudo/typeorm`** exists to translate core's persistence contracts to
  TypeORM (adapter, filter translation, error mapping, transactions). It
  can't depend on NestJS or `@crudo/nest` — an adapter must be usable from
  any future framework binding.
- **`@crudo/nest`** exists to bind Crudo to NestJS (module, decorator,
  route generation, exception filter, Swagger). It can't depend on TypeORM
  or `@crudo/typeorm` — it sees persistence only as an injected
  `RepositoryAdapter`.

Every package earns its place: core is the hub, and the two edges each
adapt exactly one external technology. Nothing else qualifies in v6.

## 3. Dependency rules — mechanically enforced

Two independent enforcement layers:

1. **TS project references** (`tsconfig.json` solution + per-package
   `references`) make build order correct and make an undeclared
   cross-package import a compile error.
2. **dependency-cruiser** (`.dependency-cruiser.cjs`, run in `pnpm check`)
   forbids: core importing anything, adapter↔framework imports in either
   direction, cross-package deep imports past a barrel, and runtime import
   cycles (type-only cycles are exempt — core's contracts are mutually
   referential by design and erase at compile time).

## 4. Workspace tooling: pnpm + plain scripts (ADR-0003)

pnpm workspaces (assumed by the phase plan) with **plain root scripts**, no
task runner. The entire build graph is three packages whose ordering is
already fully expressed by TS project references — `tsc -b` performs
incremental, dependency-ordered, cached builds natively. A task runner
(turborepo/nx) would add a second place where the graph is declared, a
cache layer duplicating `.tsbuildinfo`, and config to keep honest, while
buying nothing at this scale. Revisit only if the workspace gains many
packages or expensive non-tsc pipelines (Phase 17's e2e suite is the
natural checkpoint).

Root scripts: `build` (`tsc -b`), `clean`, `depcruise`, and `check`
(build + boundaries) — `pnpm check` is the Milestone A verification gate.

## 5. Public vs. internal API surface

Each package's `exports` map exposes **only the barrel**:

```jsonc
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
```

No subpath exports; deep imports are not API and Node will refuse them at
runtime once published. Core's barrel is an explicit named list
(ADR-0010) so the public surface only changes on purpose — it is the
input to the Phase 18 api-extractor gate. Milestone A ships ESM only;
dual ESM+CJS output is Phase 18's deliverable.

## 6. Build strategy

`tsc -b` against the solution file: incremental (`.tsbuildinfo`),
project-reference-ordered (core → typeorm/nest), each package emitting
`dist/` with declarations + declaration maps. Consumers inside the
workspace resolve `@crudo/*` via pnpm workspace links to the built
`dist`, exactly as external consumers will.

## 7. Versioning: lockstep (ADR-0004)

All `@crudo/*` packages share one version number and release together.
The packages form one tightly coupled contract surface — a core contract
change almost always touches an edge package, and a single version answers
"which adapter works with which core" permanently. Cost: occasional no-op
version bumps for an untouched package — accepted as trivially cheap next
to cross-package version-matrix support. Release mechanics (changesets,
publish order) are Phase 18.

## 8. Dependency classification (decided now, executed in Phase 18)

| Package          | `dependencies` | `peerDependencies`                                              |
| ---------------- | -------------- | --------------------------------------------------------------- |
| `@crudo/core`    | — (none, ever) | —                                                               |
| `@crudo/typeorm` | `@crudo/core`  | `typeorm`                                                       |
| `@crudo/nest`    | `@crudo/core`  | `@nestjs/common`, `@nestjs/core` (+ `@nestjs/swagger` optional) |

Peers, not dependencies, because the consumer's app owns the TypeORM/Nest
instance — a second copy via a nested dependency would fracture
`instanceof` checks and DI tokens.
