# Nest + TypeORM

Kavo's engine (`@kavo/core`) is ORM-agnostic — it talks to your data through a small adapter seam. `@kavo/nest` generates the routes; `@kavo/typeorm` adapts Kavo to a TypeORM `DataSource`. This is the complete, minimal wiring for that combination.

If you haven't yet, read [Getting started](/getting-started) first — this page assumes you already know what `@Kavo()` does and just needs the app-wiring.

```bash
pnpm add @kavo/core @kavo/nest @kavo/typeorm
```

## Zero-config wiring

A plain TypeORM entity:

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

`@Kavo(Book)` with no config object — zero-config, the full CRUD surface for free:

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
import { createInfrastructure } from "@kavo/typeorm";
import { DataSource } from "typeorm";
import { Book } from "./book.entity.js";
import { BookController } from "./book.controller.js";

const dataSource = await new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [Book],
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

`createInfrastructure(dataSource)` derives both Kavo's entity metadata and its repository adapter from the `DataSource`'s own TypeORM metadata — nothing to declare twice.
