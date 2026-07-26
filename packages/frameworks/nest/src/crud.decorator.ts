import { Body, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import type {
  ClassRef,
  DefaultCrudService,
  EntityConfig,
  EntityInput,
  OperationDescriptor,
  QueryContext,
  StandardOperationId,
} from "@kavo/core";
import { WireQuery, createOperationRegistry } from "@kavo/core";
import type { CrudHttpMethod, CrudRouteOptions } from "./operation-metadata.js";
import { CRUD_CONTROLLER_METADATA, CRUD_SERVICE_PROPERTY, getCrudServiceToken } from "./tokens.js";
import { flattenQuery } from "./flatten-query.js";
import { applySwaggerMetadata } from "./swagger.js";

/** What `@Crud` records on the controller for `KavoModule.forFeature`. */
export interface CrudControllerMetadata {
  readonly entity: ClassRef;
  readonly config?: EntityConfig<object>;
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
 * **enabled** entry: disabled operations get no route, custom operations
 * get theirs from `meta.routes`, and `meta.routes.enabled: false` keeps an
 * operation service-only.
 *
 * Driving the loop from the registry is what lets a **custom** operation
 * need no change here: it arrives as an entry and carries its own route in
 * `meta.routes`. A new **standard** operation is a different matter — it
 * also needs a default shape in `STANDARD_ROUTES`, a delegation arm in
 * `makeHandler`, and, if it takes no body, an entry in `BODYLESS_WRITES`.
 * Those three tables are keyed by `StandardOperationId`, so a typo fails
 * the build, but they are still three tables and this file does change.
 *
 * **Manual-method-wins:** a hand-written controller method whose name
 * matches an operation id suppresses that generated route — no conflicts,
 * no config, for the genuine one-off.
 *
 * Route generation happens at decoration time (class definition), which is
 * what lets Nest's router see the methods during its normal controller
 * scan — Nest maps routes before any module lifecycle hook runs, so this
 * is the only moment that works. The service instance arrives later, via
 * the `forFeature` provider, through property injection.
 *
 * The generic parameters are inferred and exist purely to typecheck the
 * call site: allowlist and relation-edge keys, DTO slots and custom-operation
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
    Reflect.defineMetadata(
      CRUD_CONTROLLER_METADATA,
      { entity, config: erasedConfig } satisfies CrudControllerMetadata,
      target,
    );
    // Property injection: generated methods reach the bound service via
    // `this[CRUD_SERVICE_PROPERTY]` without touching the constructor.
    Inject(getCrudServiceToken(entity))(controller.prototype, CRUD_SERVICE_PROPERTY);

    const registry = createOperationRegistry(erasedConfig);
    for (const descriptor of registry.all()) {
      if (!descriptor.enabled) continue;
      const route = resolveRoute(descriptor);
      if (route === null) continue;
      const methodName = descriptor.id;
      if (Object.prototype.hasOwnProperty.call(controller.prototype, methodName)) {
        continue; // manual-method-wins
      }
      defineRoute(controller.prototype, methodName, descriptor, route);
      applySwaggerMetadata(controller.prototype, methodName, descriptor, route, entity, erasedConfig);
    }
  };
}

function resolveRoute(descriptor: OperationDescriptor<object>): ResolvedRoute | null {
  const options: CrudRouteOptions = descriptor.meta.routes ?? {};
  if (options.enabled === false) return null; // service-only
  // Custom ids are absent from the table by design — they carry their own
  // route in `meta.routes` and fall back to the defaults below.
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
    Query()(prototype, methodName, index++);
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
        return this[CRUD_SERVICE_PROPERTY].findMany(wire(query) as never);
      };
    case "findOne":
      return async function (this: BoundController, id: unknown, query: unknown) {
        return this[CRUD_SERVICE_PROPERTY].findOne(id as never, wire(query) as never);
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

function wire(query: unknown): WireQuery {
  return new WireQuery(flattenQuery((query ?? {}) as Readonly<Record<string, unknown>>));
}
