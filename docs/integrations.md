# Integrations

Kavo's engine (`@kavo/core`) is ORM-agnostic — it talks to your data through a small adapter seam. `@kavo/nest` generates the routes; `@kavo/typeorm` and `@kavo/prisma` are the two adapters that plug an ORM into that seam today. Each section below is a complete, minimal wiring for one combination.

If you haven't yet, read [Getting started](/getting-started) first — this page assumes you already know what `@Kavo()` does and just need the app-wiring for your ORM.

## Nest + TypeORM

```bash
pnpm add @kavo/core @kavo/nest @kavo/typeorm typeorm
```

```ts
// book.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity()
export class Book {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;
}
```

```ts
// book.controller.ts
import { Controller } from "@nestjs/common";
import { Kavo } from "@kavo/nest";
import { Book } from "./book.entity.js";

@Kavo(Book)
@Controller("books")
export class BookController {}
```

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { KavoModule } from "@kavo/nest";
import { createTypeOrmInfrastructure } from "@kavo/typeorm";
import { DataSource } from "typeorm";
import { Book } from "./book.entity.js";
import { BookController } from "./book.controller.js";

const dataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [Book],
});

@Module({
  imports: [
    KavoModule.forRootAsync({
      useFactory: async () => {
        await dataSource.initialize();
        return { infrastructure: createTypeOrmInfrastructure(dataSource) };
      },
    }),
  ],
  controllers: [BookController],
})
export class AppModule {}
```

`createTypeOrmInfrastructure(dataSource)` derives both Kavo's entity metadata and its repository adapter from the `DataSource`'s own TypeORM metadata — nothing to declare twice.

## Nest + Prisma

```bash
pnpm add @kavo/core @kavo/nest @kavo/prisma @prisma/client
```

Prisma generates no runtime class for a model, so each entity needs a small **marker class** — an empty class whose name matches the Prisma model, used purely as a stable identity for `@Kavo()` (see [ADR-0017](/internals/adr/0017-prisma-marker-classes-and-entity-registry) for why):

```ts
// book.entity.ts
export class Book {
  id!: number;
  title!: string;
}
```

```ts
// book.controller.ts
import { Controller } from "@nestjs/common";
import { Kavo } from "@kavo/nest";
import { Book } from "./book.entity.js";

@Kavo(Book)
@Controller("books")
export class BookController {}
```

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { KavoModule } from "@kavo/nest";
import { createPrismaInfrastructure } from "@kavo/prisma";
import { PrismaClient, Prisma } from "@prisma/client";
import { Book } from "./book.entity.js";
import { BookController } from "./book.controller.js";

const prisma = new PrismaClient();

@Module({
  imports: [
    KavoModule.forRootAsync({
      useFactory: () => ({
        infrastructure: createPrismaInfrastructure(prisma, {
          datamodel: Prisma.dmmf.datamodel,
          entities: [Book],
        }),
      }),
    }),
  ],
  controllers: [BookController],
})
export class AppModule {}
```

`entities` must list every marker class this Kavo root will use — that's how a relation on one model resolves back to the right marker class for its target model. Set `caseInsensitiveFilters: false` in that same options object if your database isn't Postgres or MongoDB (MySQL, SQLite, and SQL Server reject Prisma's `mode: "insensitive"` outright).

## Where to go next

- [Getting started](/getting-started) if you haven't wired up your first entity yet.
- The **For contributors** sidebar section has the full TypeORM and Prisma adapter architecture docs, and the ADRs behind these design choices, if you want more depth than this page covers.
