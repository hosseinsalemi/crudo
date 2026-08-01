---
name: quick-start
description: Fastest path to a working Kavo API in a brand-new project — npm install list, minimal tsconfig, a single plain entity (no DTOs), and a zero-config @Kavo controller over SQLite. Use when scaffolding a new Kavo app from scratch or answering "how do I get started with Kavo" questions.
---

# Quick start — new project, SQLite + Nest + TypeORM only

The fastest working slice: one entity, one controller, zero DTOs, an
on-disk SQLite file. No Postgres, no GraphQL, no bulk — add those later
from the other skills (`kavo-decorator`, `global-config`, `dto-slots`,
`graphql-binding`) once this runs. Swagger docs are one optional step,
covered at the end (§9).

## 1. Create the project

```bash
mkdir my-kavo-app && cd my-kavo-app
npm init -y
```

Set `"type": "module"` in `package.json` — every `@kavo/*` package ships as
ESM only:

```json
{
  "name": "my-kavo-app",
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/main.js"
  }
}
```

## 2. Install packages

Runtime dependencies — Nest, TypeORM, the SQLite driver, and the three
`@kavo/*` packages:

```bash
npm install @nestjs/common @nestjs/core @nestjs/platform-express \
  reflect-metadata rxjs typeorm better-sqlite3 \
  @kavo/core @kavo/nest @kavo/typeorm
```

Dev dependencies — TypeScript and Node types only (no test runner needed
for this quick start):

```bash
npm install -D typescript @types/node
```

That's the whole install — no `@nestjs/swagger` (optional peer, skip it
until you want generated API docs) and no `graphql` (optional peer, only
needed for the `graphql-binding` skill).

## 3. `tsconfig.json`

Decorator metadata (`emitDecoratorMetadata`) is load-bearing — both
TypeORM's entity columns and Nest's DI need it:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`useDefineForClassFields: false` matters here: with it on, TypeORM's
`@Column()` decorators can't see field initializers correctly.

## 4. One plain entity — no DTOs

`src/cat/cat.entity.ts`:

```ts
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Cat {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  name!: string;

  @Column("int")
  age!: number;
}
```

That's it — no `CreateCatDto`/`UpdateCatDto`/`CatItemDto` files. Left
unregistered, every DTO slot derives straight from the entity (see
`dto-slots`): the create/update body is every writable column, and the
response is every readable column. Add explicit DTO classes later, only
once you actually need to narrow a shape.

## 5. One controller — zero-config `@Kavo`

`src/cat/cat.controller.ts`:

```ts
import { Controller } from "@nestjs/common";
import { Kavo } from "@kavo/nest";
import { Cat } from "./cat.entity.js";

@Kavo(Cat)
@Controller("cats")
export class CatController {}
```

This one decorator generates the full REST surface:

| Method | Path        | Status |
| ------ | ----------- | ------ |
| POST   | `/cats`     | 201    |
| GET    | `/cats`     | 200    |
| GET    | `/cats/:id` | 200    |
| PUT    | `/cats/:id` | 200    |
| PATCH  | `/cats/:id` | 200    |
| DELETE | `/cats/:id` | 204    |

`GET /cats` already supports `filter[...]`, `sort=`, `limit`/`offset`, and
`fields=` out of the box — see `query-grammar` for the full grammar once
you're past this quick start.

## 6. Wire it up — `src/app.module.ts`

```ts
import { Module } from "@nestjs/common";
import { KavoModule } from "@kavo/nest";
import { createTypeOrmInfrastructure } from "@kavo/typeorm";
import { DataSource } from "typeorm";
import { Cat } from "./cat/cat.entity.js";
import { CatController } from "./cat/cat.controller.js";

@Module({
  imports: [
    KavoModule.forRootAsync({
      useFactory: async () => {
        const dataSource = await new DataSource({
          type: "better-sqlite3",
          database: "db.sqlite", // on-disk file; use ":memory:" for a throwaway db
          entities: [Cat],
          synchronize: true, // fine for a quick start; use migrations for anything real
        }).initialize();

        return { infrastructure: createTypeOrmInfrastructure(dataSource) };
      },
    }),
  ],
  controllers: [CatController],
})
export class AppModule {}
```

`KavoModule.forRootAsync` builds the Kavo root instance and registers the
problem-details exception filter app-wide — nothing else to add for errors
to come back as RFC 9457 JSON (see `error-handling`). A plain Nest
`controllers:` array is all `@Kavo` classes ever need; there's no separate
per-entity registration step.

## 7. `src/main.ts`

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

void bootstrap();
```

## 8. Run it

```bash
npm run build
npm start
```

```bash
curl -X POST localhost:3000/cats -H "content-type: application/json" -d '{"name":"Whiskers","age":3}'
curl localhost:3000/cats
curl "localhost:3000/cats?filter[age][gte]=1&sort=-age"
```

## 9. Add Swagger/OpenAPI docs (optional)

One extra install, no `@Kavo` config needed — every generated route
documents itself automatically once `@nestjs/swagger` is present:

```bash
npm install @nestjs/swagger
```

```ts
// src/main.ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("My Kavo API").setVersion("1.0.0").build(),
  );
  SwaggerModule.setup("docs", app, document); // → GET /docs

  await app.listen(3000);
}

void bootstrap();
```

Full detail (what gets documented automatically vs. what still needs a
hand-written `@ApiQuery()`/`@ApiOperation()`) is in the `swagger` skill.

## Where to go next

- More than one entity, or entities that relate to each other → add each
  to the same `entities: [...]` array and give each its own `@Kavo`
  controller; relation config is in `kavo-decorator`.
- Narrowing request/response shapes with real DTO classes → `dto-slots`.
- App-wide defaults (pagination limits, disabling an operation everywhere)
  → `global-config`.
- Soft delete / restore / purge → `soft-delete`.
- OpenAPI docs → `swagger`. GraphQL → install the optional `graphql` peer
  and see `graphql-binding`.
