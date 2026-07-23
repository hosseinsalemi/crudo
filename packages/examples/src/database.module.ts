import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Owner } from "./owner.entity.js";
import { Pet } from "./pet.entity.js";
import { Cat } from "./cat.entity.js";
import { Dog } from "./dog.entity.js";

export const DATA_SOURCE = Symbol("DATA_SOURCE");

/**
 * One SQLite `DataSource` for the whole app. In-memory keeps the demo
 * (and its e2e suite) dependency-free; swap `database` for a file path or
 * a Postgres config without touching anything else.
 */
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      useFactory: async (): Promise<DataSource> => {
        const dataSource = new DataSource({
          type: "better-sqlite3",
          database: ":memory:",
          entities: [Owner, Pet, Cat, Dog],
          synchronize: true,
        });
        return dataSource.initialize();
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule {}
