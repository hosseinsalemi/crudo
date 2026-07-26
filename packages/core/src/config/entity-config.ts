import type { KavoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { FieldPath } from "../types/field-path.js";
import type { QueryContext } from "../query/query-context.js";
import type { DtoClass, OperationDtoMap } from "../dto/dto.js";
import type { EntityInput } from "../types/utility.js";
import type { OperationHandler, OperationMetadata } from "../operations/operation-handler.js";
import type { StandardOperationId } from "../operations/operation.js";

/**
 * Security allowlists (Phase 5): what a request may filter, sort, and
 * select on — including relation paths. Anything outside an allowlist is
 * rejected with a 400 (`QueryValidationException`), never silently
 * dropped. When omitted, the allowlists derive from the `query` DTO or
 * entity metadata at bootstrap.
 */
export interface QueryAllowlists<Entity = unknown> {
  readonly filterable?: readonly FieldPath<Entity>[];
  readonly sortable?: readonly FieldPath<Entity>[];
  readonly selectable?: readonly FieldPath<Entity>[];
}

/**
 * Per-operation configuration (control surface lands in Phase 13).
 * Settings keys override entity scope for this operation only; `false` in
 * the parent `operations` record disables the operation outright.
 */
export interface OperationConfig<Entity = unknown> extends DeepPartial<KavoSettings> {
  /**
   * Turn the operation on or off explicitly, overriding its default. The
   * long form of the `false` / `true` shorthands in the parent
   * `operations` record — spell it out when the entry also carries
   * settings or `meta`.
   */
  readonly enabled?: boolean;
  /** Replacement handler — keeps the default DTO/serialization scaffolding. */
  readonly handler?: OperationHandler<Entity>;
  /** Opaque metadata consumed by the framework layer (route options). */
  readonly meta?: OperationMetadata;
}

/**
 * A developer-defined operation (Phase 13). Unlike an override, a custom
 * operation declares its own input/output DTOs — its shape isn't
 * guaranteed CRUD-like. Route generation (including the `http: false`
 * service-only mode) is expressed through `meta` by `@kavo/nest`'s
 * `OperationMetadata` augmentation.
 */
export interface CustomOperationConfig<Entity = unknown> {
  readonly input?: DtoClass;
  readonly output?: DtoClass;
  readonly handler: OperationHandler<Entity>;
  readonly meta?: OperationMetadata;
}

/**
 * Raw entity-scope configuration — the second argument to `createCrud`.
 * Settings keys (inherited from `DeepPartial<KavoSettings>`) override
 * global scope for this entity.
 */
export interface EntityConfig<
  Entity,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
> extends DeepPartial<KavoSettings> {
  readonly dto?: OperationDtoMap<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>;
  readonly allowlists?: QueryAllowlists<Entity>;
  /**
   * Per-operation overrides. `false` disables the operation; `true`
   * enables one that is off by default (`purgeOne`, `restoreOne`).
   */
  readonly operations?: Partial<Record<StandardOperationId, OperationConfig<Entity> | boolean>>;
  /** New operations, dispatched through the same registry (Phase 13). */
  readonly customOperations?: Readonly<Record<string, CustomOperationConfig<Entity>>>;
}
