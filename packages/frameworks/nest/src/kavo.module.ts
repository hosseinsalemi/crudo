import type { DynamicModule, ModuleMetadata, Provider, Type } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { KavoInstance } from "@kavo/core";
import { ConfigurationException, createKavo } from "@kavo/core";
import type { KavoModuleOptions } from "./kavo-options.js";
import type { CrudControllerMetadata } from "./crud.decorator.js";
import { KavoExceptionFilter } from "./kavo-exception.filter.js";
import { KAVO_INSTANCE, KAVO_MODULE_OPTIONS, CRUD_CONTROLLER_METADATA, getCrudServiceToken } from "./tokens.js";

export interface KavoModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  useFactory: (...args: never[]) => KavoModuleOptions | Promise<KavoModuleOptions>;
  inject?: readonly (string | symbol | Type)[];
}

/**
 * The Kavo dynamic module (Phases 11–12).
 *
 * - `forRoot`/`forRootAsync` (global): create the Kavo root instance and
 *   register the problem-details exception filter app-wide.
 * - `forFeature(controllers)`: for each `@Crud`-decorated controller,
 *   provide the entity's `CrudService` under `getCrudServiceToken(Entity)`
 *   and register the controller. The service is a **singleton** — the
 *   engine threads all per-request state through `CrudContext`, so
 *   request scope would only cost throughput.
 */
@Module({})
export class KavoModule {
  static forRoot(options: KavoModuleOptions = {}): DynamicModule {
    return {
      module: KavoModule,
      global: true,
      providers: [
        { provide: KAVO_MODULE_OPTIONS, useValue: options },
        {
          provide: KAVO_INSTANCE,
          useFactory: (resolved: KavoModuleOptions): KavoInstance => createInstance(resolved),
          inject: [KAVO_MODULE_OPTIONS],
        },
        { provide: APP_FILTER, useClass: KavoExceptionFilter },
      ],
      exports: [KAVO_INSTANCE, KAVO_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: KavoModuleAsyncOptions): DynamicModule {
    return {
      module: KavoModule,
      global: true,
      imports: [...(options.imports ?? [])],
      providers: [
        {
          provide: KAVO_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: [...(options.inject ?? [])] as never[],
        },
        {
          provide: KAVO_INSTANCE,
          useFactory: (resolved: KavoModuleOptions): KavoInstance => createInstance(resolved),
          inject: [KAVO_MODULE_OPTIONS],
        },
        { provide: APP_FILTER, useClass: KavoExceptionFilter },
      ],
      exports: [KAVO_INSTANCE, KAVO_MODULE_OPTIONS],
    };
  }

  static forFeature(controllers: readonly Type[]): DynamicModule {
    const providers: Provider[] = controllers.map((controller) => {
      const metadata = Reflect.getMetadata(CRUD_CONTROLLER_METADATA, controller) as CrudControllerMetadata | undefined;
      if (metadata === undefined) {
        throw new ConfigurationException(
          controller.name,
          "forFeature",
          `${controller.name} is not decorated with @Crud(Entity) — ` +
            "KavoModule.forFeature only accepts @Crud controllers",
        );
      }
      return {
        provide: getCrudServiceToken(metadata.entity),
        useFactory: (kavo: KavoInstance) => kavo.createCrud(metadata.entity, metadata.config),
        inject: [KAVO_INSTANCE],
      };
    });
    return {
      module: KavoModule,
      controllers: [...controllers],
      providers,
      exports: providers,
    };
  }
}

function createInstance(options: KavoModuleOptions): KavoInstance {
  return createKavo({
    ...(options.defaults !== undefined && { defaults: options.defaults }),
    ...(options.infrastructure !== undefined && {
      infrastructure: options.infrastructure,
    }),
    ...(options.paginationStrategies !== undefined && {
      paginationStrategies: options.paginationStrategies,
    }),
  });
}
