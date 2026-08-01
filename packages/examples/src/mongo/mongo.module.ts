import { Module, type DynamicModule } from "@nestjs/common";
import mongoose from "mongoose";
import { KavoModule } from "@kavo/nest";
import { createMongooseInfrastructure } from "@kavo/mongoose";
import { ArticleController } from "./article.controller.js";
import { AuthorController } from "./author.controller.js";

/**
 * Reference wiring for `@kavo/mongoose`, and the counterpart to
 * `AppModule`: the app hands `@kavo/nest` its infrastructure, and the two
 * packages never import each other — they meet in the DI container.
 *
 * Note how much smaller this is than `AppModule` + `DatabaseModule`. There
 * is no entity list and no `DataSource` to build, because
 * `mongoose.connection` already *is* the model registry
 * `createMongooseInfrastructure` needs (ADR-0018).
 *
 * The caller connects before serving traffic — `mongoose.connect(uri)` in
 * `main-mongo.ts`, or against a `mongodb-memory-server` instance in
 * `tests/app-mongo.e2e.spec.ts`. Building the infrastructure does not
 * require an open connection; issuing a query does.
 */
@Module({})
export class MongoAppModule {
  static forRoot(): DynamicModule {
    return {
      module: MongoAppModule,
      imports: [
        KavoModule.forRoot({
          infrastructure: createMongooseInfrastructure(mongoose.connection),
          defaults: {
            pagination: { defaultLimit: 20, maxLimit: 100 },
            errors: { exposeInternals: false },
          },
        }),
      ],
      controllers: [AuthorController, ArticleController],
    };
  }
}
