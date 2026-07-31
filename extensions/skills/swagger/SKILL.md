---
name: swagger
description: Reference for Kavo's optional Swagger/OpenAPI integration — installing @nestjs/swagger, what generated routes document automatically, and what's still a manual addition. Use when adding API docs to a Kavo app, or answering "how do I get OpenAPI docs for these routes" questions.
---

# Swagger / OpenAPI reference

`@nestjs/swagger` is an **optional peer** of `@kavo/nest` — install it and
every generated route documents itself automatically; leave it out and
`@Crud` costs nothing extra. No config flag turns this on or off: Kavo
detects the package at runtime (`createRequire(...).require("@nestjs/swagger")`,
cached, never throws if absent) and documents routes only when it's there.
Full detail: `docs/architecture/10-nestjs-integration.md` §4.

## Install

```bash
npm install @nestjs/swagger
```

That's the only step — no `@Crud` config option, no `KavoModule` option.
Existing `@Crud`-decorated controllers pick up documentation the next time
the app boots with `@nestjs/swagger` present.

## Wiring the docs endpoint (`main.ts`)

This is plain Nest/Swagger, not Kavo-specific — `SwaggerModule` still needs
to be told to build and serve a document:

```ts
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("My API").setVersion("1.0.0").build(),
  );
  SwaggerModule.setup("docs", app, document); // → GET /docs

  await app.listen(3000);
}

void bootstrap();
```

## What's documented automatically, per generated route

| Piece                       | Source                                                                           |
| --------------------------- | -------------------------------------------------------------------------------- |
| Operation id                | `<Entity>_<operationId>` (e.g. `User_findMany`)                                  |
| `:id` path param            | Every operation with an id in its route                                          |
| Query params on list routes | `filter`/`sort`/`fields`/pagination/`include` shape (doc 05)                     |
| Request body schema         | The entity's registered DTO class for that slot (`ApiBody`) — see `dto-slots`    |
| Error response schemas      | Problem-details shape for 400/404, from the error catalog — see `error-handling` |

This applies identically whether the route came from plain generation,
`@Override`, or config-level `operations.<id>.meta` overrides — Swagger
metadata is applied through the same `applyRouteDecorators` step as the
route's method/param/status decorators.

## What is _not_ generated (manual work today)

- **Allowlist-derived per-field query documentation.** `filter[field][op]=`
  is documented as a generic shape, not expanded into one `ApiQuery` per
  actual filterable/sortable field — that needs ORM metadata, which doesn't
  exist yet at `@Crud` decoration time (ADR-0012). If you want per-field
  query docs today, add them yourself with plain `@ApiQuery()` on the
  controller class.
- **Fully custom, registry-independent routes** (see `crud-decorator`'s
  section on those) get no automatic Swagger metadata — they're ordinary
  Nest methods, so document them with plain `@ApiOperation()`/`@ApiBody()`
  etc. exactly as you would on any non-`@Crud` controller.
- **GraphQL routes** (see `graphql-binding`) are a separate binding entirely
  and are not covered by this REST-focused Swagger integration.
