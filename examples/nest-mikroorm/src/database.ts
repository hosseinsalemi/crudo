import { MikroORM } from "@mikro-orm/core";
import { defineConfig as defineSqliteConfig } from "@mikro-orm/sqlite";
import { defineConfig as definePostgresConfig } from "@mikro-orm/postgresql";
import { Address } from "./address/address.entity.js";
import { Cat } from "./cat/cat.entity.js";
import { Dog } from "./dog/dog.entity.js";
import { Owner } from "./owner/owner.entity.js";
import { Pet } from "./pet/pet.entity.js";
import { Tag } from "./tag/tag.entity.js";

/**
 * Every entity this app registers, in one place — MikroORM's own list, and
 * the only one: unlike `@kavo/prisma` there are no marker classes to keep in
 * sync, and unlike `nest-typeorm` there is no second registry, because the
 * `MikroORM` instance *is* what `createInfrastructure` reads.
 *
 * The abstract `Pet` base is registered alongside its subtypes: MikroORM
 * needs the inheritance root to resolve the discriminator, and `Owner.pets`
 * targets it.
 */
const entities = [Owner, Pet, Cat, Dog, Tag, Address];

/** Connection details for the Postgres flavour of this example. */
export interface PostgresOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly dbName: string;
}

/**
 * The default flavour: SQLite in memory, so the example runs — and its e2e
 * suite passes — with no database to install and no Docker daemon.
 *
 * `allowGlobalContext` is deliberately left off (its default). `@kavo/mikroorm`
 * forks an `EntityManager` per operation, which is the isolation a
 * request-scoped `RequestContext` would otherwise provide, so an app wired
 * this way needs no MikroORM middleware for Kavo's routes — and leaving the
 * guard on means any code that *does* reach for the global EM fails loudly.
 */
export async function createSqliteOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init(defineSqliteConfig({ dbName: ":memory:", entities }));
  await orm.schema.create();
  return orm;
}

/**
 * The Postgres flavour. Worth having as more than a second connection
 * string: `caseInsensitiveFilters` is only *true* here, because MikroORM's
 * `$ilike` is PostgreSQL-only — see `AppModule.forRoot` and doc 17 §2.
 */
export async function createPostgresOrm(options: PostgresOptions): Promise<MikroORM> {
  const orm = await MikroORM.init(definePostgresConfig({ ...options, entities }));
  await orm.schema.refresh();
  return orm;
}
