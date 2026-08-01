# Kavo

A production-grade CRUD framework for TypeScript: define an entity once
(via TypeORM, Prisma, or Mongoose) and get the full REST CRUD surface — filtering, sorting,
pagination, nested includes, field selection, optional per-operation DTOs,
transactions, and problem-details errors — behind generated NestJS routes,
configurable at global, entity, operation, and per-call scope.

The design is documented in [`docs`](docs) — the
architecture notes and ADRs there are authoritative, and the naming
conventions in [`CLAUDE.md`](CLAUDE.md) are normative.

## Packages

| Package                                       | Role                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| [`@kavo/core`](packages/core)                 | Contracts, type system, engine — zero runtime dependencies       |
| [`@kavo/typeorm`](packages/orms/typeorm)      | TypeORM adapter (`RepositoryAdapter` implementation)             |
| [`@kavo/prisma`](packages/orms/prisma)        | Prisma adapter (`RepositoryAdapter` implementation)              |
| [`@kavo/mongoose`](packages/orms/mongoose)    | Mongoose adapter (`RepositoryAdapter` implementation)            |
| [`@kavo/nest`](packages/frameworks/nest)      | NestJS binding (`@Kavo` decorator, route generation)             |
| [`@kavo/graphql`](packages/protocols/graphql) | Host-agnostic GraphQL schema binding over a `createCrud` service |

Design docs, glossary, and ADRs live in [`docs`](docs).

## Install

`@kavo/core` has zero runtime dependencies; `@kavo/typeorm`, `@kavo/prisma`,
`@kavo/mongoose`, `@kavo/nest`, and `@kavo/graphql` each need their
ORM/framework/protocol as a peer dependency:

```bash
# core contracts and engine — always required
pnpm add @kavo/core

# TypeORM adapter
pnpm add @kavo/typeorm typeorm reflect-metadata

# Prisma adapter
pnpm add @kavo/prisma @prisma/client

# Mongoose adapter
pnpm add @kavo/mongoose mongoose

# NestJS binding (the @Kavo decorator and route generation)
pnpm add @kavo/nest @nestjs/common @nestjs/core reflect-metadata rxjs
# optional, for OpenAPI schema generation:
pnpm add @nestjs/swagger

# GraphQL schema binding (host-framework-agnostic)
pnpm add @kavo/graphql graphql
```

(`npm install` / `yarn add` work the same way.) See
[`packages/examples`](packages/examples) for a full, runnable NestJS +
TypeORM app wired up with all four packages.

## Claude Code skills

If you use Claude Code, [`extensions`](extensions) has nine
ready-made skills covering `@Kavo()`, global config, the query grammar,
DTOs, errors, soft delete, Swagger, and GraphQL — published as a plugin via
this repo's own marketplace:

```
/plugin marketplace add kavo-labs/kavo
/plugin install kavo-skills@kavo-marketplace
```

See [`extensions`](extensions) for a manual, non-plugin install
option.

## Development

```bash
pnpm install
pnpm check   # tsc -b (project references) + dependency-cruiser boundaries
```
