import { Global, Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Owner } from "./owner/owner.entity.js";
import { Pet } from "./pet/pet.entity.js";
import { Cat } from "./cat/cat.entity.js";
import { Dog } from "./dog/dog.entity.js";
import { Tag } from "./tag/tag.entity.js";
import { Address } from "./address/address.entity.js";

export const DATA_SOURCE = Symbol("DATA_SOURCE");

const entities = [Owner, Pet, Cat, Dog, Tag, Address];

/**
 * One `DataSource` for the whole app. Defaults to an in-memory SQLite
 * database, keeping the demo (and its e2e suite) dependency-free; setting
 * `PGHOST` switches the same app to a real Postgres instance instead — see
 * `packages/examples/README.md` for the `docker run` used locally, and
 * `tests/app-postgres.e2e.spec.ts` for how the e2e suite self-provisions one
 * via Testcontainers.
 *
 * Global so `DATA_SOURCE` is injectable straight into any `@Crud`
 * controller (e.g. `AddressController`'s `@Override`'d methods), not just
 * where `DatabaseModule` is nested (`KavoModule.forRootAsync`'s own
 * `imports`).
 */
@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      useFactory: async (): Promise<DataSource> => {
        const dataSource = process.env.PGHOST
          ? new DataSource({
              type: "postgres",
              host: process.env.PGHOST,
              port: Number(process.env.PGPORT ?? 5432),
              username: process.env.PGUSER ?? "postgres",
              password: process.env.PGPASSWORD ?? "kavo",
              database: process.env.PGDATABASE ?? "kavo",
              entities,
              synchronize: true,
            })
          : new DataSource({
              type: "better-sqlite3",
              database: ":memory:",
              entities,
              synchronize: true,
            });
        return dataSource.initialize();
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule {}
