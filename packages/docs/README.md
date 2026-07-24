# Crudo documentation

Design documentation for the Crudo framework, produced by Milestones A–C
of `crudo-phases-v6.md` and maintained alongside the code.

## Milestone A — Blueprint

- [architecture/01-system-architecture.md](architecture/01-system-architecture.md) — layers, boundaries, lifecycle, patterns, non-goals, tradeoffs (Phase 1)
- [architecture/02-monorepo-and-packages.md](architecture/02-monorepo-and-packages.md) — package design, dependency rules, tooling, versioning (Phase 2)
- [architecture/03-core-contracts-and-type-system.md](architecture/03-core-contracts-and-type-system.md) — generic parameters, `FieldPath`, module augmentation (Phase 3)

## Milestone B — Walking skeleton

- [architecture/04-dto-system.md](architecture/04-dto-system.md) — the six slots, derivation rules, resolution, serialization order (Phase 4)
- [architecture/05-query-grammar.md](architecture/05-query-grammar.md) — the query-string grammar reference: operators, rules, limits, coercion (Phase 5)
- [architecture/06-error-handling.md](architecture/06-error-handling.md) — exception hierarchy, error-code catalog, problem details (Phase 6)
- [architecture/07-crud-engine.md](architecture/07-crud-engine.md) — request lifecycle, context, built-in handlers, root factory (Phase 7)
- [architecture/08-configuration.md](architecture/08-configuration.md) — schema, precedence chain, merge semantics, bootstrap validation (Phase 8)
- [architecture/09-typeorm-adapter.md](architecture/09-typeorm-adapter.md) — metadata seam, query translation, error mapping, seams (Phases 9–10)
- [architecture/10-nestjs-integration.md](architecture/10-nestjs-integration.md) — module design, route generation, exception filter, Swagger (Phases 11–12)

## Milestone C — Core features

- [architecture/11-soft-delete.md](architecture/11-soft-delete.md) — strategy resolution, restore/purge, `withDeleted`, unique-index and cascade edges (Phase 14)
- [architecture/12-relations-and-includes.md](architecture/12-relations-and-includes.md) — relation registry, include resolution, join/batch loading, pagination rule, write-side (Phase 15)

## Reference

- [glossary.md](glossary.md) — one canonical name per concept
- [adr/](adr/) — architecture decision records, referenced by later phases instead of re-arguing
