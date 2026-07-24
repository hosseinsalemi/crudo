# ADR-0004 — Lockstep versioning

**Status:** accepted (Phase 2; release mechanics in Phase 18)

## Context

Independent versioning lets an untouched package skip releases, but forces
a compatibility matrix ("which `@crudo/typeorm` works with which
`@crudo/core`?") that every consumer and every bug report must consult.

## Decision

All `@crudo/*` packages share one version and release together. Peer
ranges between them pin the same version line.

## Consequences

- "Crudo 0.4" fully identifies a consumer's setup; cross-package bugs are
  reproducible from one number.
- Occasional no-op bumps of untouched packages — trivially cheap in an
  automated pipeline (Phase 18 changesets).
- A core-breaking change cannot ship before dependents catch up, because
  they ship in the same release.
