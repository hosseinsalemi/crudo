# Crudo

A production-grade CRUD framework for TypeScript: define an entity once
(via TypeORM) and get the full REST CRUD surface — filtering, sorting,
pagination, nested includes, field selection, optional per-operation DTOs,
transactions, and problem-details errors — behind generated NestJS routes,
configurable at global, entity, operation, and per-call scope.

The design is documented in [`packages/docs`](packages/docs) — the
architecture notes and ADRs there are authoritative, and the naming
conventions in [`CLAUDE.md`](CLAUDE.md) are normative.

## Packages

| Package                                   | Role                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| [`@crudo/core`](packages/core)            | Contracts, type system, engine — zero runtime dependencies |
| [`@crudo/typeorm`](packages/orms/typeorm) | TypeORM adapter (`RepositoryAdapter` implementation)       |
| [`@crudo/nest`](packages/frameworks/nest) | NestJS binding (`@Crud` decorator, route generation)       |

Design docs, glossary, and ADRs live in [`packages/docs`](packages/docs).

## Status

**Milestones A–C: complete.** The full CRUD surface runs end-to-end —
filtering, sorting, pagination, layered configuration, problem-details
errors, operation control, soft delete/restore/purge, and nested relation
includes — through TypeORM behind generated NestJS routes.

Remaining work (DX API, reference application, npm release) is tracked in
[`packages/docs/roadmap.md`](packages/docs/roadmap.md).

## Development

```bash
pnpm install
pnpm check   # tsc -b (project references) + dependency-cruiser boundaries
```
