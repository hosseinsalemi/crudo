# Crudo

A production-grade CRUD framework for TypeScript: define an entity once
(via TypeORM) and get the full REST CRUD surface — filtering, sorting,
pagination, nested includes, field selection, optional per-operation DTOs,
transactions, and problem-details errors — behind generated NestJS routes,
configurable at global, entity, operation, and per-call scope.

Built phase-by-phase from [`crudo-phases-v6.md`](crudo-phases-v6.md) (the
authoritative spec; its Naming Conventions section is normative).

## Packages

| Package | Role |
| --- | --- |
| [`@crudo/core`](packages/core) | Contracts, type system, engine — zero runtime dependencies |
| [`@crudo/typeorm`](packages/orms/typeorm) | TypeORM adapter (`RepositoryAdapter` implementation) |
| [`@crudo/nest`](packages/frameworks/nest) | NestJS binding (`@Crud` decorator, route generation) |

Design docs, glossary, and ADRs live in [`packages/docs`](packages/docs).

## Status

**Milestone A — Blueprint (Phases 1–3): complete.** Architecture,
monorepo, and the full `@crudo/core` contract/type system; no runtime
code yet. Next: Milestone B (walking skeleton), starting at Phase 4.

## Development

```bash
pnpm install
pnpm check   # tsc -b (project references) + dependency-cruiser boundaries
```
