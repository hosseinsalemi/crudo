# ADR-0003 — pnpm workspaces + plain scripts + `tsc -b`; no task runner

**Status:** accepted (Phase 2)

## Context

The workspace needs ordered, incremental builds across three packages.
Task runners (turborepo, nx) offer graph orchestration and caching — at
the price of a second declaration of the dependency graph and another
config surface.

## Decision

pnpm workspaces with plain root scripts. `tsc -b` against the solution
`tsconfig.json` is the build orchestrator: TS project references already
declare the graph once, and `tsc -b` gives dependency ordering and
`.tsbuildinfo` incrementality natively. `pnpm check` = build + dependency-
cruiser — the CI gate.

## Consequences

- One source of truth for the build graph; no cache/config drift.
- No remote caching or parallel non-tsc pipelines — irrelevant at three
  type-only/type-heavy packages.
- Revisit when the workspace gains many packages or expensive non-tsc
  steps (Phase 17 e2e is the checkpoint); adopting a runner later is
  additive since scripts stay per-package.
