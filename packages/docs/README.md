# Kavo documentation

Design documentation for the Kavo framework, maintained alongside the code.

These documents and the [ADRs](adr/) are authoritative.

## Blueprint

- [architecture/01-system-architecture.md](architecture/01-system-architecture.md) — layers, boundaries, lifecycle, patterns, non-goals, tradeoffs
- [architecture/02-monorepo-and-packages.md](architecture/02-monorepo-and-packages.md) — package design, dependency rules, tooling, versioning
- [architecture/03-core-contracts-and-type-system.md](architecture/03-core-contracts-and-type-system.md) — generic parameters, `FieldPath`, module augmentation

## Walking skeleton

- [architecture/04-dto-system.md](architecture/04-dto-system.md) — the six slots, derivation rules, resolution, serialization order
- [architecture/05-query-grammar.md](architecture/05-query-grammar.md) — the query-string grammar reference: operators, rules, limits, coercion
- [architecture/06-error-handling.md](architecture/06-error-handling.md) — exception hierarchy, error-code catalog, problem details
- [architecture/07-crud-engine.md](architecture/07-crud-engine.md) — request lifecycle, context, built-in handlers, root factory
- [architecture/08-configuration.md](architecture/08-configuration.md) — schema, precedence chain, merge semantics, bootstrap validation
- [architecture/09-typeorm-adapter.md](architecture/09-typeorm-adapter.md) — metadata seam, query translation, error mapping, seams
- [architecture/10-nestjs-integration.md](architecture/10-nestjs-integration.md) — module design, route generation, exception filter, Swagger

## Core features

- [architecture/11-soft-delete.md](architecture/11-soft-delete.md) — strategy resolution, restore/purge, `withDeleted`, unique-index and cascade edges
- [architecture/12-relations-and-includes.md](architecture/12-relations-and-includes.md) — relation registry, include resolution, join/batch loading, pagination rule, write-side

## Reference

- [glossary.md](glossary.md) — one canonical name per concept
- [adr/](adr/) — architecture decision records, referenced elsewhere instead of re-arguing
