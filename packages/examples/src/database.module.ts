import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { User } from "./user.entity.js";

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
          entities: [User],
          synchronize: true,
        });
        return dataSource.initialize();
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule {}
