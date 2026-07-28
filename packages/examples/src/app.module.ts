import { Module } from "@nestjs/common";
import { KavoModule } from "@kavo/nest";
import { createTypeOrmInfrastructure } from "@kavo/typeorm";
import type { DataSource } from "typeorm";
import { DATA_SOURCE, DatabaseModule } from "./database.module.js";
import { OwnerController } from "./owner/owner.controller.js";
import { CatController } from "./cat/cat.controller.js";
import { DogController } from "./dog/dog.controller.js";
import { TagController } from "./tag/tag.controller.js";
import { AddressController } from "./address/address.controller.js";

/**
 * Reference wiring: the app hands `@kavo/nest` its infrastructure (here
 * TypeORM's) — the packages never import each other (Phase 2 boundary;
 * adapters meet the framework in the DI container).
 */
@Module({
  imports: [
    KavoModule.forRootAsync({
      imports: [DatabaseModule],
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
        },
      }),
    }),
  ],
  controllers: [OwnerController, CatController, DogController, TagController, AddressController],
})
export class AppModule {}
