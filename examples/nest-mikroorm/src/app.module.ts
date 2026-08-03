import { Module, type DynamicModule } from "@nestjs/common";
import type { MikroORM } from "@mikro-orm/core";
import { KavoModule } from "@kavo/nest";
import { createInfrastructure } from "@kavo/mikroorm";
import { AddressController } from "./address/address.controller.js";
import { CatController } from "./cat/cat.controller.js";
import { DogController } from "./dog/dog.controller.js";
import { OwnerController } from "./owner/owner.controller.js";
import { TagController } from "./tag/tag.controller.js";

export interface AppOptions {
  /** An already-initialized ORM — see `database.ts` for the two flavours. */
  readonly orm: MikroORM;
  /**
   * Whether the driver supports MikroORM's `$ilike`. **PostgreSQL only** —
   * every other driver receives the token verbatim and fails with a syntax
   * error, which is why this is a declared setting rather than something
   * the adapter detects (doc 17 §2). Left `false` for the SQLite flavour,
   * where it costs nothing: SQLite's own `LIKE` is already ASCII
   * case-insensitive.
   */
  readonly caseInsensitiveFilters?: boolean;
}

/**
 * Reference wiring: the app hands `@kavo/nest` its infrastructure (here
 * MikroORM's) — the packages never import each other (package boundary;
 * adapters meet the framework in the DI container).
 *
 * Like the Mongoose example and unlike `nest-typeorm`, there is no entity
 * list and no `DataSource` to assemble here, because the `MikroORM`
 * instance already carries its own entity metadata — the same reason this
 * adapter needs no marker classes.
 *
 * `createInfrastructure` takes the ORM instance rather than an
 * `EntityManager` on purpose: every adapter operation forks its own manager
 * from it, so it needs something to fork *from*.
 */
@Module({})
export class AppModule {
  static forRoot(options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        KavoModule.forRoot({
          infrastructure: createInfrastructure(options.orm, {
            caseInsensitiveFilters: options.caseInsensitiveFilters ?? false,
          }),
          defaults: {
            pagination: { defaultLimit: 20, maxLimit: 100 },
            errors: { exposeInternals: false },
            // App-wide default: off unless an entity opts back in via its own
            // `operations.restoreOne`. `OwnerController` does exactly that,
            // which is what makes the precedence chain visible here.
            operations: { restoreOne: false },
          },
        }),
      ],
      controllers: [OwnerController, CatController, DogController, TagController, AddressController],
    };
  }
}
