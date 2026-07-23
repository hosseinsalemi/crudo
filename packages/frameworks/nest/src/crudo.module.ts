import type {
  DynamicModule,
  ModuleMetadata,
  Provider,
  Type,
} from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { CrudoInstance } from "@crudo/core";
import { ConfigurationException, createCrudo } from "@crudo/core";
import type { CrudoModuleOptions } from "./crudo-options.js";
import type { CrudControllerMetadata } from "./crud.decorator.js";
import { CrudoExceptionFilter } from "./crudo-exception.filter.js";
import {
  CRUDO_INSTANCE,
  CRUDO_MODULE_OPTIONS,
  CRUD_CONTROLLER_METADATA,
  getCrudServiceToken,
} from "./tokens.js";

export interface CrudoModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  useFactory: (
    ...args: never[]
  ) => CrudoModuleOptions | Promise<CrudoModuleOptions>;
  inject?: readonly (string | symbol | Type)[];
}

/**
 * The Crudo dynamic module (Phases 11–12).
 *
 * - `forRoot`/`forRootAsync` (global): create the Crudo root instance and
 *   register the problem-details exception filter app-wide.
 * - `forFeature(controllers)`: for each `@Crud`-decorated controller,
 *   provide the entity's `CrudService` under `getCrudServiceToken(Entity)`
 *   and register the controller. The service is a **singleton** — the
 *   engine threads all per-request state through `CrudContext`, so
 *   request scope would only cost throughput.
 */
@Module({})
export class CrudoModule {
  static forRoot(options: CrudoModuleOptions = {}): DynamicModule {
    return {
      module: CrudoModule,
      global: true,
      providers: [
        { provide: CRUDO_MODULE_OPTIONS, useValue: options },
        {
          provide: CRUDO_INSTANCE,
          useFactory: (resolved: CrudoModuleOptions): CrudoInstance =>
            createInstance(resolved),
          inject: [CRUDO_MODULE_OPTIONS],
        },
        { provide: APP_FILTER, useClass: CrudoExceptionFilter },
      ],
      exports: [CRUDO_INSTANCE, CRUDO_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: CrudoModuleAsyncOptions): DynamicModule {
    return {
      module: CrudoModule,
      global: true,
      imports: [...(options.imports ?? [])],
      providers: [
        {
          provide: CRUDO_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: [...(options.inject ?? [])] as never[],
        },
        {
          provide: CRUDO_INSTANCE,
          useFactory: (resolved: CrudoModuleOptions): CrudoInstance =>
            createInstance(resolved),
          inject: [CRUDO_MODULE_OPTIONS],
        },
        { provide: APP_FILTER, useClass: CrudoExceptionFilter },
      ],
      exports: [CRUDO_INSTANCE, CRUDO_MODULE_OPTIONS],
    };
  }

  static forFeature(controllers: readonly Type[]): DynamicModule {
    const providers: Provider[] = controllers.map((controller) => {
      const metadata = Reflect.getMetadata(
        CRUD_CONTROLLER_METADATA,
        controller,
      ) as CrudControllerMetadata | undefined;
      if (metadata === undefined) {
        throw new ConfigurationException(
          controller.name,
          "forFeature",
          `${controller.name} is not decorated with @Crud(Entity) — ` +
            "CrudoModule.forFeature only accepts @Crud controllers",
        );
      }
      return {
        provide: getCrudServiceToken(metadata.entity),
        useFactory: (crudo: CrudoInstance) =>
          crudo.createCrud(metadata.entity, metadata.config),
        inject: [CRUDO_INSTANCE],
      };
    });
    return {
      module: CrudoModule,
      controllers: [...controllers],
      providers,
      exports: providers,
    };
  }
}

function createInstance(options: CrudoModuleOptions): CrudoInstance {
  return createCrudo({
    ...(options.defaults !== undefined && { defaults: options.defaults }),
    ...(options.infrastructure !== undefined && {
      infrastructure: options.infrastructure,
    }),
    ...(options.paginationStrategies !== undefined && {
      paginationStrategies: options.paginationStrategies,
    }),
  });
}
