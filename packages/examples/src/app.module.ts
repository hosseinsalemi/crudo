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
import { Address } from "./address/address.entity.js";
import { bindAddressRuntime } from "./address/address.runtime.js";

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
      useFactory: (dataSource: DataSource) => {
        const infrastructure = createTypeOrmInfrastructure(dataSource);
        // Address's operation overrides are captured at decoration time
        // (ADR-0012), before this factory ever runs — bind the adapter they
        // need now that it exists (see address.runtime.ts).
        bindAddressRuntime({ adapter: infrastructure.adapterFor(Address), dataSource });
        return {
          infrastructure,
          defaults: {
            pagination: { defaultLimit: 20, maxLimit: 100 },
            errors: { exposeInternals: false },
          },
        };
      },
    }),
    KavoModule.forFeature([OwnerController, CatController, DogController, TagController, AddressController]),
  ],
})
export class AppModule {}
