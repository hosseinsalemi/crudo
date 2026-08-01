# Getting started

Kavo turns your ORM entities into a full REST CRUD API. Define the entity once, add one decorator, and you get create, read, update, delete, filtering, sorting, pagination, nested includes, and field selection — with no hand-written controller methods.

Today Kavo supports NestJS as the framework, over either TypeORM or Prisma as the ORM. This guide uses Nest + TypeORM as its example stack; see [Nest + Prisma](/integrations/nest/prisma) for the Prisma equivalent.

## Install

```bash
pnpm add @kavo/core @kavo/nest @kavo/typeorm
```

- `@kavo/core` — the engine.
- `@kavo/nest` — generates the NestJS routes.
- `@kavo/typeorm` — adapts Kavo to a TypeORM `DataSource`. See [Nest + TypeORM](/integrations/nest/typeorm) for the full wiring.

## Zero-config `@Kavo()`

Given a plain TypeORM entity:

```ts
// book.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity()
export class Book {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column()
  author!: string;
}
```

put `@Kavo(Book)` on an empty Nest controller:

```ts
// book.controller.ts
import { Controller } from "@nestjs/common";
import { Kavo } from "@kavo/nest";
import { Book } from "./book.entity.js";

@Kavo(Book)
@Controller("books")
export class BookController {}
```

That's it — no config object, no service, no repository wiring in the controller. This generates:

| Method   | Route        | What it does                                |
| -------- | ------------ | ------------------------------------------- |
| `POST`   | `/books`     | Create a book                               |
| `GET`    | `/books`     | List books — filtering, sorting, pagination |
| `GET`    | `/books/:id` | Get one book                                |
| `PUT`    | `/books/:id` | Replace a book                              |
| `PATCH`  | `/books/:id` | Partially update a book                     |
| `DELETE` | `/books/:id` | Delete a book                               |

Requests and responses are shaped straight from `Book`'s own columns — there's no DTO to write until you want to narrow or reshape what's exposed. The list route (`GET /books`) already understands query-string filtering and sorting out of the box, for example:

```
GET /books?filter[author][eq]=Tolkien&sort=-title&limit=10&offset=0
```

## Wiring it into a Nest app

`@Kavo`-decorated controllers need one thing from the app: a `KavoModule` that hands them infrastructure (a `DataSource`, in the TypeORM case).

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { KavoModule } from "@kavo/nest";
import { createInfrastructure } from "@kavo/typeorm";
import { DataSource } from "typeorm";
import { BookController } from "./book.controller.js";

const dataSource = await new DataSource({
  /* ...your TypeORM connection options... */
}).initialize();

@Module({
  imports: [
    KavoModule.forRoot({
      infrastructure: createInfrastructure(dataSource),
    }),
  ],
  controllers: [BookController],
})
export class AppModule {}
```

`KavoModule` discovers every `@Kavo`-decorated controller registered in `controllers: [...]` and binds each one's generated service — no per-entity registration step.

## Soft delete

Give an entity a delete-marker column and Kavo stops actually deleting rows on `DELETE /books/:id` — it stamps the marker instead, and every read (`GET /books`, `GET /books/:id`, includes) automatically excludes stamped rows, with no query changes on your side:

```ts
import { Entity, PrimaryGeneratedColumn, Column, DeleteDateColumn } from "typeorm";

@Entity()
export class Book {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
```

That column alone is enough for `deleteOne` to soft-delete and for reads to hide deleted rows. Two more capabilities are opt-in, one config line each, because each is a piece of public API worth stating on purpose rather than getting for free:

- **Restore** — `@Kavo(Book, { softDelete: { strategy: "soft" } })` turns on `PATCH /books/:id/restore`, which clears the marker and returns the row again.
- **Purge** — `@Kavo(Book, { operations: { purgeOne: true } })` turns on `DELETE /books/:id/purge`, which permanently removes an already-soft-deleted row.

Both can be combined. Attempting to restore a row that isn't deleted, or purge one that is still live, returns a 409, not a silent no-op. Pass `?withDeleted=true` on a read to opt back into seeing soft-deleted rows for that request. See [Soft delete, restore & purge](/internals/architecture/11-soft-delete) for the full behavior — unique-index caveats, cascades, and what's deliberately not built (bulk restore/purge).
