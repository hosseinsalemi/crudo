# Kavo

A production-grade CRUD framework for TypeScript: define an entity once
(via TypeORM) and get the full REST CRUD surface — filtering, sorting,
pagination, nested includes, field selection, optional per-operation DTOs,
transactions, and problem-details errors — behind generated NestJS routes,
configurable at global, entity, operation, and per-call scope.

The design is documented in [`packages/docs`](packages/docs) — the
architecture notes and ADRs there are authoritative, and the naming
conventions in [`CLAUDE.md`](CLAUDE.md) are normative.

## Packages

| Package                                  | Role                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| [`@kavo/core`](packages/core)            | Contracts, type system, engine — zero runtime dependencies |
| [`@kavo/typeorm`](packages/orms/typeorm) | TypeORM adapter (`RepositoryAdapter` implementation)       |
| [`@kavo/nest`](packages/frameworks/nest) | NestJS binding (`@Crud` decorator, route generation)       |

Design docs, glossary, and ADRs live in [`packages/docs`](packages/docs).

## Install

`@kavo/core` has zero runtime dependencies; `@kavo/typeorm` and `@kavo/nest`
each need their ORM/framework as a peer dependency:

```bash
# core contracts and engine — always required
pnpm add @kavo/core

# TypeORM adapter
pnpm add @kavo/typeorm typeorm reflect-metadata

# NestJS binding (the @Crud decorator and route generation)
pnpm add @kavo/nest @nestjs/common @nestjs/core reflect-metadata rxjs
# optional, for OpenAPI schema generation:
pnpm add @nestjs/swagger
```

(`npm install` / `yarn add` work the same way.) See
[`packages/examples`](packages/examples) for a full, runnable NestJS +
TypeORM app wired up with all three packages.

## Status

**Milestones A–C: complete.** The full CRUD surface runs end-to-end —
filtering, sorting, pagination, layered configuration, problem-details
errors, operation control, soft delete/restore/purge, and nested relation
includes — through TypeORM behind generated NestJS routes.

`@kavo/core`, `@kavo/typeorm`, and `@kavo/nest` are published to npm
(current: `0.1.0`, pre-1.0 — expect breaking changes).

## Development

```bash
pnpm install
pnpm check   # tsc -b (project references) + dependency-cruiser boundaries
```
