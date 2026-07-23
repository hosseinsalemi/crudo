import { Module } from "@nestjs/common";
import { CrudoModule } from "@crudo/nest";
import { createTypeOrmInfrastructure } from "@crudo/typeorm";
import type { DataSource } from "typeorm";
import { DATA_SOURCE, DatabaseModule } from "./database.module.js";
import { UserController } from "./user.controller.js";

/**
 * Milestone B checkpoint wiring: the app hands `@crudo/nest` its
 * infrastructure (here TypeORM's) — the packages never import each other
 * (Phase 2 boundary; adapters meet the framework in the DI container).
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
    CrudoModule.forFeature([UserController]),
  ],
})
export class AppModule {}
