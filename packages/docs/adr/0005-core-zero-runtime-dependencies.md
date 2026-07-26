# ADR-0005 — Zero runtime dependencies in `@kavo/core`

**Status:** accepted (Phases 1–3)

## Context

Core is imported by every Kavo package and every consumer app. Each
dependency it carried would be imposed on all of them (conflicts, weight,
supply chain), and third-party types tend to leak into public signatures,
making someone else's types part of Kavo's API.

## Decision

`@kavo/core` has **no** runtime dependencies — not TypeORM, not NestJS,
not utility libraries, directly or transitively. If core needs a helper,
core writes it. Enforced by dependency-cruiser's `core-imports-nothing`
rule, not by convention.

## Consequences

- Framework/ORM independence is structural, not aspirational.
- Occasional small reimplementations (e.g. a deep-merge in Phase 8) —
  accepted; they're tiny and fully owned.
- `sideEffects: false` + types-heavy design keeps core tree-shakable for
  consumers importing only contracts.
