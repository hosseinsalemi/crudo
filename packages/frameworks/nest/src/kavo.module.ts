import type { DynamicModule, ModuleMetadata, OnModuleInit, Provider, Type } from "@nestjs/common";
import { Inject, Injectable, Module } from "@nestjs/common";
import { APP_FILTER, DiscoveryModule, DiscoveryService } from "@nestjs/core";
import type { ClassRef, KavoInstance } from "@kavo/core";
import { ConfigurationException, createKavo } from "@kavo/core";
import type { KavoModuleOptions } from "./kavo-options.js";
import type { CrudControllerMetadata } from "./crud.decorator.js";
import { getRegisteredCrudControllers } from "./crud.decorator.js";
import { KavoExceptionFilter } from "./kavo-exception.filter.js";
import { createDefaultGraphQLController, DEFAULT_GRAPHQL_PATH } from "./graphql/default-graphql.controller.js";
import {
  KAVO_INSTANCE,
  KAVO_MODULE_OPTIONS,
  CRUD_CONTROLLER_METADATA,
  CRUD_SERVICE_PROPERTY,
  getCrudServiceToken,
} from "./tokens.js";

/** `graphql: true` mounts the default controller at `POST /graphql`; `{ path }` mounts it at `POST <path>` instead. */
export type KavoGraphQLOption = boolean | { readonly path?: string };

function graphqlPathFrom(option: KavoGraphQLOption | undefined): string | undefined {
  if (option === undefined || option === false) return undefined;
  if (option === true) return DEFAULT_GRAPHQL_PATH;
  return option.path ?? DEFAULT_GRAPHQL_PATH;
}

export interface KavoModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  useFactory: (...args: never[]) => KavoModuleOptions | Promise<KavoModuleOptions>;
  inject?: readonly (string | symbol | Type)[];
  /**
   * Fold in what `forFeature()` (no arguments) does — a DI provider under
   * `getCrudServiceToken(Entity)` for every `@Crud`-decorated class the
   * process has seen — so a normal app needs only this one call. Off by
   * default for the same reason the standalone no-arg `forFeature()` is
   * opt-in: the registry is process-wide, and `@kavo/nest`'s own tests
   * decorate many differently-configured classes against the same entity
   * in one file.
   */
  provideServices?: boolean;
  /**
   * Mounts a default GraphQL controller — every `@Crud` entity that also
   * called `registerCrudGraphQLTypes` (`@kavo/graphql`), merged onto one
   * schema, with no controller of your own to write. `true` mounts it at
   * `POST /graphql`; `{ path: "api/graphql" }` mounts it there instead.
   * Implies `provideServices` (the merged schema's resolvers need every
   * entity's service as a DI provider to look up via `ModuleRef`, the same
   * requirement `BaseCrudGraphQLController` always has) even if
   * `provideServices` itself is left unset.
   */
  graphql?: KavoGraphQLOption;
}

/**
 * The Kavo dynamic module (auto-discovery per issue feedback on the
 * checkpoint app's wiring).
 *
 * - `forRoot`/`forRootAsync` (global): create the Kavo root instance,
 *   register the problem-details exception filter app-wide, and register
 *   `KavoCrudBinder` — an `onModuleInit` pass that uses `@nestjs/core`'s
 *   `DiscoveryService` to find every `@Crud`-decorated controller already
 *   in the app's module graph (an ordinary Nest `controllers:` array is
 *   enough to put it there) and assign its bound service directly onto
 *   `this[CRUD_SERVICE_PROPERTY]`. No DI provider or explicit list is
 *   needed for this — the generated route methods only ever read that
 *   property at request time, well after `onModuleInit` has run.
 * - `forFeature(controllers)`: registers the controllers (redundant once
 *   they're already in some module's `controllers:` array) and additionally
 *   provides the entity's `CrudService` under `getCrudServiceToken(Entity)`
 *   as a real DI provider — needed only by a controller (or other class)
 *   that constructor-injects that token itself, e.g. to reach the base
 *   service from a fully custom, registry-independent route. `forFeature()`
 *   called with **no arguments** does the same for every `@Crud`-decorated
 *   class the process has seen so far, with no list at all — the scope that
 *   makes this safe (one config per entity, one Kavo instance per process)
 *   is exactly a normal app, not `@kavo/nest`'s own tests, which always pass
 *   an explicit array. Prefer `boundCrudService(this)` inside a
 *   `@Crud`-decorated class over either form when the consumer is that same
 *   class.
 * - `{ provideServices: true }` on `forRoot`/`forRootAsync` folds the
 *   no-argument `forFeature()` in directly, so a normal app states its
 *   Kavo config in one call instead of two.
 *
 * The service is a **singleton** either way — the engine threads all
 * per-request state through `CrudContext`, so request scope would only
 * cost throughput.
 */
@Module({})
export class KavoModule {
  static forRoot(
    options: KavoModuleOptions & { provideServices?: boolean; graphql?: KavoGraphQLOption } = {},
  ): DynamicModule {
    const { provideServices, graphql, ...kavoOptions } = options;
    const graphqlPath = graphqlPathFrom(graphql);
    const serviceProviders = provideServices === true || graphqlPath !== undefined ? providersFromRegistry() : [];
    return {
      module: KavoModule,
      global: true,
      imports: [DiscoveryModule],
      controllers: graphqlPath !== undefined ? [createDefaultGraphQLController(graphqlPath)] : [],
      providers: [
        { provide: KAVO_MODULE_OPTIONS, useValue: kavoOptions },
        {
          provide: KAVO_INSTANCE,
          useFactory: (resolved: KavoModuleOptions): KavoInstance => createInstance(resolved),
          inject: [KAVO_MODULE_OPTIONS],
        },
        { provide: APP_FILTER, useClass: KavoExceptionFilter },
        KavoCrudBinder,
        ...serviceProviders,
      ],
      exports: [KAVO_INSTANCE, KAVO_MODULE_OPTIONS, ...serviceProviders],
    };
  }

  static forRootAsync(options: KavoModuleAsyncOptions): DynamicModule {
    const graphqlPath = graphqlPathFrom(options.graphql);
    const serviceProviders =
      options.provideServices === true || graphqlPath !== undefined ? providersFromRegistry() : [];
    return {
      module: KavoModule,
      global: true,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      controllers: graphqlPath !== undefined ? [createDefaultGraphQLController(graphqlPath)] : [],
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
        KavoCrudBinder,
        ...serviceProviders,
      ],
      exports: [KAVO_INSTANCE, KAVO_MODULE_OPTIONS, ...serviceProviders],
    };
  }

  /**
   * Called with an explicit array: registers those controllers and, for
   * each, provides its entity's `CrudService` under
   * `getCrudServiceToken(Entity)`.
   *
   * Called with no arguments: provides every entity in the registry `@Crud`
   * populates at decoration time — no controller list, since the caller
   * already put them in an ordinary `controllers:` array (the
   * `KavoCrudBinder` covers those; this form exists purely for a
   * constructor-injected `getCrudServiceToken`). Fails fast if two
   * different controllers registered the same entity — the provider token
   * is per-entity, so which config wins would otherwise be silently
   * ambiguous.
   */
  static forFeature(controllers?: readonly Type[]): DynamicModule {
    if (controllers === undefined) {
      const providers = providersFromRegistry();
      return { module: KavoModule, providers, exports: providers };
    }
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

function providersFromRegistry(): Provider[] {
  const ownerByEntity = new Map<ClassRef, Function>();
  const providers: Provider[] = [];
  for (const [controller, metadata] of getRegisteredCrudControllers()) {
    const existingOwner = ownerByEntity.get(metadata.entity);
    if (existingOwner !== undefined) {
      throw new ConfigurationException(
        metadata.entity.name,
        "forFeature",
        `both '${(existingOwner as Type).name}' and '${(controller as Type).name}' are @Crud(${metadata.entity.name}) — ` +
          "KavoModule.forFeature() with no arguments needs at most one controller per entity; " +
          "pass an explicit array to disambiguate",
      );
    }
    ownerByEntity.set(metadata.entity, controller);
    providers.push({
      provide: getCrudServiceToken(metadata.entity),
      useFactory: (kavo: KavoInstance) => kavo.createCrud(metadata.entity, metadata.config),
      inject: [KAVO_INSTANCE],
    });
  }
  return providers;
}

/**
 * Runs once at `onModuleInit`, after Nest has finished instantiating every
 * controller in the app — late enough that `DiscoveryService` sees the full,
 * real module graph, and still well before the first request, which is all
 * the generated route methods need (they read `CRUD_SERVICE_PROPERTY` at
 * request time, never at construction time).
 */
@Injectable()
class KavoCrudBinder implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    @Inject(KAVO_INSTANCE) private readonly kavo: KavoInstance,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getControllers()) {
      const metatype = wrapper.metatype;
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (metatype === null || instance === undefined) continue;
      const metadata = Reflect.getMetadata(CRUD_CONTROLLER_METADATA, metatype) as CrudControllerMetadata | undefined;
      if (metadata === undefined) continue;
      instance[CRUD_SERVICE_PROPERTY] = this.kavo.createCrud(metadata.entity, metadata.config);
    }
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
