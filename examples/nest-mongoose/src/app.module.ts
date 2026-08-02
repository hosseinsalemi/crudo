import { Module, type DynamicModule } from "@nestjs/common";
import mongoose from "mongoose";
import { KavoModule } from "@kavo/nest";
import { createInfrastructure } from "@kavo/mongoose";
import { ArticleController } from "./article/article.controller.js";
import { AuthorController } from "./author/author.controller.js";

/**
 * Reference wiring: the app hands `@kavo/nest` its infrastructure (here
 * Mongoose's) — the packages never import each other (package boundary;
 * adapters meet the framework in the DI container).
 *
 * Note how much smaller this is than `nest-typeorm`'s `AppModule` +
 * `DatabaseModule`. There is no entity list and no `DataSource` to build,
 * because `mongoose.connection` already *is* the model registry
 * `createInfrastructure` needs (ADR-0018).
 *
 * The caller connects before serving traffic — `mongoose.connect(uri)` in
 * `main.ts`, or against a `mongodb-memory-server` instance in
 * `tests/app.e2e.spec.ts`. Building the infrastructure does not require an
 * open connection; issuing a query does.
 */
@Module({})
export class AppModule {
  static forRoot(): DynamicModule {
    return {
      module: AppModule,
      imports: [
        KavoModule.forRoot({
          infrastructure: createInfrastructure(mongoose.connection),
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
