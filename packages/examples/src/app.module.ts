import { Module, type DynamicModule } from "@nestjs/common";
import { KavoModule } from "@kavo/nest";
import { createTypeOrmInfrastructure } from "@kavo/typeorm";
import type { DataSource } from "typeorm";
import { DATA_SOURCE, DatabaseModule, type PostgresOptions } from "./database.module.js";
import { OwnerController } from "./owner/owner.controller.js";
import { CatController } from "./cat/cat.controller.js";
import { DogController } from "./dog/dog.controller.js";
import { TagController } from "./tag/tag.controller.js";
import { AddressController } from "./address/address.controller.js";

/**
 * Reference wiring: the app hands `@kavo/nest` its infrastructure (here
 * TypeORM's) — the packages never import each other (Phase 2 boundary;
 * adapters meet the framework in the DI container).
 *
 * `forRoot()` defaults to the in-memory SQLite `DatabaseModule`;
 * `forRoot(postgres)` threads the same options through to a real Postgres
 * instance instead (see `DatabaseModule`).
 */
@Module({})
export class AppModule {
  static forRoot(postgres?: PostgresOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        KavoModule.forRootAsync({
          imports: [DatabaseModule.forRoot(postgres)],
          inject: [DATA_SOURCE] as never[],
          // AddressController constructor-injects its own service
          // (getCrudServiceToken), which needs a real DI provider —
          // provideServices supplies one for every @Crud entity registered so
          // far, with no separate call or list to keep in sync.
          provideServices: true,
          useFactory: (dataSource: DataSource) => ({
            infrastructure: createTypeOrmInfrastructure(dataSource),
            defaults: {
              pagination: { defaultLimit: 20, maxLimit: 100 },
              errors: { exposeInternals: false },
              // App-wide default (issue #38): off unless an entity opts back
              // in via its own `operations.restoreOne`. `OwnerController`
              // does exactly that.
              operations: { restoreOne: false },
            },
          }),
        }),
      ],
      controllers: [OwnerController, CatController, DogController, TagController, AddressController],
    };
  }
}
