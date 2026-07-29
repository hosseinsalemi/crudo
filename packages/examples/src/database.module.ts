import { Global, Module, type DynamicModule } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Owner } from "./owner/owner.entity.js";
import { Pet } from "./pet/pet.entity.js";
import { Cat } from "./cat/cat.entity.js";
import { Dog } from "./dog/dog.entity.js";
import { Tag } from "./tag/tag.entity.js";
import { Address } from "./address/address.entity.js";

export const DATA_SOURCE = Symbol("DATA_SOURCE");

const entities = [Owner, Pet, Cat, Dog, Tag, Address];

export interface PostgresOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * One `DataSource` for the whole app. `forRoot()` (no argument) defaults to
 * an in-memory SQLite database, keeping the demo (and its e2e suite)
 * dependency-free; `forRoot(postgres)` switches the same app to a real
 * Postgres instance instead — see `packages/examples/README.md` for the
 * `docker run` used locally, and `tests/app-postgres.e2e.spec.ts` for how
 * the e2e suite self-provisions one via Testcontainers.
 *
 * Global so `DATA_SOURCE` is injectable straight into any `@Crud`
 * controller (e.g. `AddressController`'s `@Override`'d methods), not just
 * where `DatabaseModule` is nested (`KavoModule.forRootAsync`'s own
 * `imports`).
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(postgres?: PostgresOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATA_SOURCE,
          useFactory: async (): Promise<DataSource> => {
            const dataSource = postgres
              ? new DataSource({
                  type: "postgres",
                  ...postgres,
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
    };
  }
}
