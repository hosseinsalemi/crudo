import { Global, Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Owner } from "./owner/owner.entity.js";
import { Pet } from "./pet/pet.entity.js";
import { Cat } from "./cat/cat.entity.js";
import { Dog } from "./dog/dog.entity.js";
import { Tag } from "./tag/tag.entity.js";
import { Address } from "./address/address.entity.js";

export const DATA_SOURCE = Symbol("DATA_SOURCE");

/**
 * One SQLite `DataSource` for the whole app. In-memory keeps the demo
 * (and its e2e suite) dependency-free; swap `database` for a file path or
 * a Postgres config without touching anything else.
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
        const dataSource = new DataSource({
          type: "better-sqlite3",
          database: ":memory:",
          entities: [Owner, Pet, Cat, Dog, Tag, Address],
          synchronize: true,
        });
        return dataSource.initialize();
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule {}
