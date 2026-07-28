import { Body, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import type {
  ClassRef,
  DefaultCrudService,
  EntityConfig,
  EntityInput,
  OperationDescriptor,
  OperationId,
  QueryContext,
  StandardOperationId,
} from "@kavo/core";
import { ConfigurationException, createOperationRegistry } from "@kavo/core";
import type { CrudHttpMethod, CrudRouteOptions } from "./operation-metadata.js";
import type { OverrideMetadata } from "./override.decorator.js";
import { CRUD_CONTROLLER_METADATA, CRUD_OVERRIDE_METADATA, CRUD_SERVICE_PROPERTY } from "./tokens.js";
import { WireQueryPipe } from "./wire-query.pipe.js";
import { applySwaggerMetadata } from "./swagger.js";

/** What `@Crud` records on the controller for `KavoModule.forFeature`. */
export interface CrudControllerMetadata {
  readonly entity: ClassRef;
  readonly config?: EntityConfig<object>;
}

/**
 * Every `@Crud`-decorated class, in decoration order — populated as a side
 * effect of the decorator running at class-definition time (import time),
 * which is always before any `KavoModule.forRoot`/`forRootAsync` call
 * (nested inside `@Module({...})`, which only runs after every controller
 * file it imports has finished evaluating). `KavoModule.forFeature()`
 * called with no arguments reads this to build one DI provider per
 * registered entity with no explicit list — the process-wide scope is why
 * this stays internal rather than something a normal app reaches for
 * directly, and why `@kavo/nest`'s own tests, which decorate many
 * differently-configured classes against the same entity in one file,
 * always pass `forFeature` an explicit array instead.
 */
const registeredCrudControllers = new Map<Function, CrudControllerMetadata>();

/** @internal used by `KavoModule.forFeature()`'s no-argument form. */
export function getRegisteredCrudControllers(): ReadonlyMap<Function, CrudControllerMetadata> {
  return registeredCrudControllers;
}

/**
 * The default route shape of each standard operation (Phase 11). `Partial`
 * because the disabled batch operations have no route yet; keyed by the
 * union so a misspelled id cannot sit here unread.
 */
const STANDARD_ROUTES: Readonly<
  Partial<Record<StandardOperationId, { method: CrudHttpMethod; path: string; status: number }>>
> = {
  createOne: { method: "POST", path: "", status: 201 },
  findMany: { method: "GET", path: "", status: 200 },
  findOne: { method: "GET", path: ":id", status: 200 },
  updateOne: { method: "PUT", path: ":id", status: 200 },
  patchOne: { method: "PATCH", path: ":id", status: 200 },
  deleteOne: { method: "DELETE", path: ":id", status: 204 },
  // Soft delete (Phase 14). These entries enable from config alone
  // (ADR-0013), and the generator needed no change to pick them up — the
  // registry is the source of truth.
  restoreOne: { method: "PATCH", path: ":id/restore", status: 200 },
  purgeOne: { method: "DELETE", path: ":id/purge", status: 204 },
};

/**
 * Write operations that target a row by id and take no request body
 * (Phase 14). Without this, `PATCH /:id/restore` would be given a `@Body`
 * parameter that is always empty.
 */
const BODYLESS_WRITES: ReadonlySet<StandardOperationId> = new Set<StandardOperationId>(["restoreOne", "purgeOne"]);

/**
 * Nest's own route-argument metadata key (`@nestjs/common/constants`'
 * `ROUTE_ARGS_METADATA`), inlined rather than deep-imported: the subpath
 * isn't part of `@nestjs/common`'s declared type exports (no `exports` map
 * restricts it at runtime, but `tsc`'s Node16 resolution can't see the
 * `.d.ts` through it), and this exact key is what every `@Param`/`@Query`/
 * `@Body` decorator reads and writes — stable across Nest's own major
 * versions, since third-party CRUD libraries already depend on it.
 */
const NEST_ROUTE_ARGS_METADATA = "__routeArguments__";

const METHOD_DECORATORS: Record<CrudHttpMethod, (path: string) => MethodDecorator> = {
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
};

interface ResolvedRoute {
  readonly method: CrudHttpMethod;
  readonly path: string;
  readonly status: number;
  readonly hasIdParam: boolean;
}

/**
 * `@Crud(UserEntity)` — registry-driven route generation (Phases 11–12).
 *
 * The decorator builds the entity's operation registry (the same
 * `createOperationRegistry` the engine uses) and generates one route per
 * **enabled** entry: disabled operations get no route, and
 * `meta.routes.enabled: false` keeps an operation service-only. A new
 * standard operation needs a default shape in `STANDARD_ROUTES`, a
 * delegation arm in `makeHandler`, and, if it takes no body, an entry in
 * `BODYLESS_WRITES` — those three tables are keyed by `StandardOperationId`,
 * so a typo fails the build.
 *
 * **Manual-method-wins:** a hand-written controller method whose name
 * matches an operation id suppresses that generated route entirely — no
 * conflicts, no config, for the genuine one-off. **`@Override(operationId?)`**
 * is the additive middle path: the decorated method still gets the
 * registry's route (method, path, status, params, Swagger), only the
 * function backing it changes — resolved first, ahead of manual-method-wins,
 * so a decorated method never falls through to plain name-matching.
 *
 * Route generation happens at decoration time (class definition), which is
 * what lets Nest's router see the methods during its normal controller
 * scan — Nest maps routes before any module lifecycle hook runs, so this
 * is the only moment that works. The service instance arrives later:
 * `KavoModule`'s discovery binder finds every `@Crud`-decorated controller
 * at `onModuleInit` (via `@nestjs/core`'s `DiscoveryService`, so no explicit
 * registration list is needed) and assigns `this[CRUD_SERVICE_PROPERTY]`
 * directly — no DI provider or constructor injection involved.
 *
 * The generic parameters are inferred and exist purely to typecheck the
 * call site: allowlist and relation-edge keys, DTO slots and overridden
 * handlers are all checked against the entity, with no manual generic
 * argument. The chain mirrors `createCrud`'s — `Entity` is inferred from
 * `entity` alone, while each DTO slot stays its own inference site, so
 * registering one slot does not constrain the others. Route generation
 * itself is entity-agnostic, so everything below consumes the erased view.
 */
export function Crud<
  Entity extends object,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
>(
  entity: ClassRef<Entity>,
  config?: EntityConfig<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>,
): ClassDecorator {
  return (target) => {
    const controller = target as unknown as {
      prototype: Record<string, unknown>;
    };
    const erasedConfig = config as EntityConfig<object> | undefined;
    const metadata: CrudControllerMetadata = { entity, config: erasedConfig };
    Reflect.defineMetadata(CRUD_CONTROLLER_METADATA, metadata, target);
    registeredCrudControllers.set(target, metadata);

    const registry = createOperationRegistry(erasedConfig);
    const overrides = collectOverrides(controller.prototype, entity.name, registry);

    for (const descriptor of registry.all()) {
      if (!descriptor.enabled) continue;
      const route = resolveRoute(descriptor);
      const overrideMethodName = overrides.get(descriptor.id);
      if (route === null) {
        if (overrideMethodName !== undefined) {
          throw new ConfigurationException(
            entity.name,
            `override.${descriptor.id}`,
            `'${overrideMethodName}' is @Override("${descriptor.id}"), but that operation is service-only ` +
              `(meta.routes.enabled: false) and generates no route to override`,
          );
        }
        continue;
      }
      if (overrideMethodName === undefined) {
        const methodName = descriptor.id;
        if (Object.prototype.hasOwnProperty.call(controller.prototype, methodName)) {
          continue; // manual-method-wins
        }
        defineRoute(controller.prototype, methodName, descriptor, route);
        applySwaggerMetadata(controller.prototype, methodName, descriptor, route, entity, erasedConfig);
      } else {
        assertNoOwnParamMetadata(controller.prototype, overrideMethodName, entity.name, descriptor.id);
        applyRouteDecorators(controller.prototype, overrideMethodName, descriptor, route);
        applySwaggerMetadata(controller.prototype, overrideMethodName, descriptor, route, entity, erasedConfig);
      }
    }
  };
}

/**
 * Builds the `operationId -> methodName` map from every `@Override`-decorated
 * method on the prototype, failing fast at decoration time (ADR-0012's only
 * moment) on the two ways this can be misconfigured: two methods claiming
 * the same operation, or an override naming an operation id that the
 * registry doesn't have enabled — a silent no-op override is a footgun.
 */
function collectOverrides(
  prototype: Record<string, unknown>,
  entityName: string,
  registry: { get(id: OperationId): OperationDescriptor<object> | undefined },
): ReadonlyMap<OperationId, string> {
  const overrides = new Map<OperationId, string>();
  for (const methodName of Object.getOwnPropertyNames(prototype)) {
    if (methodName === "constructor") continue;
    const metadata = Reflect.getMetadata(CRUD_OVERRIDE_METADATA, prototype, methodName) as OverrideMetadata | undefined;
    if (metadata === undefined) continue;
    const existing = overrides.get(metadata.operationId);
    if (existing !== undefined) {
      throw new ConfigurationException(
        entityName,
        `override.${metadata.operationId}`,
        `both '${existing}' and '${methodName}' are @Override("${metadata.operationId}") — only one method may override a given operation`,
      );
    }
    overrides.set(metadata.operationId, methodName);
  }
  for (const [operationId, methodName] of overrides) {
    const descriptor = registry.get(operationId);
    if (descriptor === undefined || !descriptor.enabled) {
      throw new ConfigurationException(
        entityName,
        `override.${operationId}`,
        `'${methodName}' is @Override("${operationId}"), but '${operationId}' is absent or disabled`,
      );
    }
  }
  return overrides;
}

/**
 * `@Override`'d methods must accept Kavo's own `@Param`/`@Query`/`@Body`
 * wiring, not their own — Nest's route-arg metadata for a method is one
 * object keyed by param index, so a method's own decorator would either
 * collide with or silently shadow the one Kavo applies next.
 */
function assertNoOwnParamMetadata(
  prototype: Record<string, unknown>,
  methodName: string,
  entityName: string,
  operationId: OperationId,
): void {
  const existing = Reflect.getMetadata(NEST_ROUTE_ARGS_METADATA, prototype.constructor, methodName);
  if (existing !== undefined) {
    throw new ConfigurationException(
      entityName,
      `override.${operationId}`,
      `'${methodName}' must not declare its own @Param/@Query/@Body — @Crud applies the operation's own param wiring`,
    );
  }
}

function resolveRoute(descriptor: OperationDescriptor<object>): ResolvedRoute | null {
  const options: CrudRouteOptions = descriptor.meta.routes ?? {};
  if (options.enabled === false) return null; // service-only
  // A non-standard id is absent from the table by design and falls back to
  // the defaults below — the registry's own genericity (ADR-0006), even
  // though `EntityConfig` offers no way to register one.
  const standard = STANDARD_ROUTES[descriptor.id as StandardOperationId];
  const method = options.method ?? standard?.method ?? "POST";
  const path = options.path ?? standard?.path ?? descriptor.id;
  const status = options.successStatus ?? standard?.status ?? (method === "POST" ? 201 : 200);
  return { method, path, status, hasIdParam: path.includes(":id") };
}

function defineRoute(
  prototype: Record<string, unknown>,
  methodName: string,
  descriptor: OperationDescriptor<object>,
  route: ResolvedRoute,
): void {
  const handler = makeHandler(descriptor, route);
  Object.defineProperty(handler, "name", { value: methodName });
  Object.defineProperty(prototype, methodName, {
    value: handler,
    writable: true,
    configurable: true,
  });
  applyRouteDecorators(prototype, methodName, descriptor, route);
}

/**
 * The Nest wiring a route needs regardless of what backs it: param
 * decorators, the success status, and the HTTP-verb decorator. Shared
 * between a freshly generated handler (`defineRoute`) and an `@Override`'d
 * method already on the prototype — the two paths carry identical route
 * metadata by construction, not by convention.
 */
function applyRouteDecorators(
  prototype: Record<string, unknown>,
  methodName: string,
  descriptor: OperationDescriptor<object>,
  route: ResolvedRoute,
): void {
  const propertyDescriptor = Object.getOwnPropertyDescriptor(prototype, methodName) as PropertyDescriptor;
  applyParamDecorators(prototype, methodName, descriptor, route);
  HttpCode(route.status)(prototype, methodName, propertyDescriptor);
  METHOD_DECORATORS[route.method](route.path)(prototype, methodName, propertyDescriptor);
}

/**
 * Parameter layout per generated method (fixed positions):
 * reads → (id?, query); writes → (id?, body). Nest's param decorators are
 * plain functions; applying them programmatically writes the same route
 * metadata the `@Param`/`@Query`/`@Body` syntax would.
 */
function applyParamDecorators(
  prototype: Record<string, unknown>,
  methodName: string,
  descriptor: OperationDescriptor<object>,
  route: ResolvedRoute,
): void {
  let index = 0;
  if (route.hasIdParam) {
    Param("id")(prototype, methodName, index++);
  }
  if (descriptor.kind === "read") {
    Query(new WireQueryPipe())(prototype, methodName, index++);
  } else if (usesBody(route.method) && !BODYLESS_WRITES.has(descriptor.id as StandardOperationId)) {
    Body()(prototype, methodName, index++);
  }
}

function usesBody(method: CrudHttpMethod): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

type BoundController = Record<string, unknown> & {
  [CRUD_SERVICE_PROPERTY]: DefaultCrudService<object>;
};

function makeHandler(
  descriptor: OperationDescriptor<object>,
  route: ResolvedRoute,
): (...args: unknown[]) => Promise<unknown> {
  const id = descriptor.id;

  // Standard operations delegate to the typed service surface; custom
  // operations go through the engine envelope — one pipeline either way.
  switch (id) {
    case "createOne":
      return async function (this: BoundController, body: unknown) {
        return this[CRUD_SERVICE_PROPERTY].createOne(body as never);
      };
    case "findMany":
      return async function (this: BoundController, query: unknown) {
        return this[CRUD_SERVICE_PROPERTY].findMany(query as never);
      };
    case "findOne":
      return async function (this: BoundController, id: unknown, query: unknown) {
        return this[CRUD_SERVICE_PROPERTY].findOne(id as never, query as never);
      };
    case "updateOne":
      return async function (this: BoundController, id: unknown, body: unknown) {
        return this[CRUD_SERVICE_PROPERTY].updateOne(id as never, body as never);
      };
    case "patchOne":
      return async function (this: BoundController, id: unknown, body: unknown) {
        return this[CRUD_SERVICE_PROPERTY].patchOne(id as never, body as never);
      };
    case "deleteOne":
      return async function (this: BoundController, id: unknown) {
        await this[CRUD_SERVICE_PROPERTY].deleteOne(id as never);
      };
    case "restoreOne":
      return async function (this: BoundController, id: unknown) {
        return this[CRUD_SERVICE_PROPERTY].restoreOne(id as never);
      };
    case "purgeOne":
      return async function (this: BoundController, id: unknown) {
        await this[CRUD_SERVICE_PROPERTY].purgeOne(id as never);
      };
    default:
      return async function (this: BoundController, ...args: unknown[]) {
        const requestId = route.hasIdParam ? (args[0] as string) : null;
        const body = route.hasIdParam ? args[1] : args[0];
        const response = await this[CRUD_SERVICE_PROPERTY].engine.execute({
          operation: id,
          id: requestId,
          body: (body ?? null) as never,
          query: null,
          options: null,
        });
        return response.item;
      };
  }
}
