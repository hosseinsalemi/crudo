import { Module } from "@nestjs/common";
import { CrudoModule } from "@crudo/nest";
import { createTypeOrmInfrastructure } from "@crudo/typeorm";
import type { DataSource } from "typeorm";
import { DATA_SOURCE, DatabaseModule } from "./database.module.js";
import { OwnerController } from "./owner/owner.controller.js";
import { CatController } from "./cat/cat.controller.js";
import { DogController } from "./dog/dog.controller.js";
import { TagController } from "./tag/tag.controller.js";
import { AddressController } from "./address/address.controller.js";

/**
 * Reference wiring: the app hands `@crudo/nest` its infrastructure (here
 * TypeORM's) — the packages never import each other (Phase 2 boundary;
 * adapters meet the framework in the DI container).
 */
@Module({
  imports: [
    CrudoModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [DATA_SOURCE] as never[],
      useFactory: (dataSource: DataSource) => ({
        infrastructure: createTypeOrmInfrastructure(dataSource),
        defaults: {
          pagination: { defaultLimit: 20, maxLimit: 100 },
          errors: { exposeInternals: false },
        },
      }),
    }),
    CrudoModule.forFeature([OwnerController, CatController, DogController, TagController, AddressController]),
  ],
})
export class AppModule {}
