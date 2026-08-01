import type { KavoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { FieldPath } from "../types/field-path.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationDtoMap } from "../dto/dto.js";
import type { EntityInput } from "../types/utility.js";
import type { OperationHandler, OperationMetadata } from "../operations/operation-handler.js";
import type { StandardOperationId } from "../operations/operation.js";

/**
 * One allowlist key's raw configuration: either the explicit set of paths
 * to allow, or `{ exclude }` — every own column except the ones named.
 * `exclude` is resolved against the entity's own columns at bootstrap
 * (`resolveAllowlists`), never evaluated eagerly here — the `@Kavo(...)`
 * config object is built at class-decoration time, before any ORM metadata
 * exists (ADR-0013), so there is nothing to resolve `exclude` against yet.
 */
export type QueryFieldSelector<Entity> =
  | readonly FieldPath<Entity>[]
  | { readonly exclude: readonly FieldPath<Entity>[] };

/**
 * Security allowlists: what a request may filter, sort, and
 * select on — including relation paths. Anything outside an allowlist is
 * rejected with a 400 (`QueryValidationException`), never silently
 * dropped. When omitted, the allowlists derive from the `query` DTO or
 * entity metadata at bootstrap.
 */
export interface QueryAllowlists<Entity = unknown> {
  readonly filterable?: QueryFieldSelector<Entity>;
  readonly sortable?: QueryFieldSelector<Entity>;
  readonly selectable?: QueryFieldSelector<Entity>;
}

/**
 * Per-operation configuration.
 * Settings keys override entity scope for this operation only; `false` in
 * the parent `operations` record disables the operation outright.
 */
export interface OperationConfig<Entity = unknown> extends Omit<DeepPartial<KavoSettings>, "operations"> {
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
> extends Omit<DeepPartial<KavoSettings>, "operations"> {
  readonly dto?: OperationDtoMap<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>;
  readonly allowlists?: QueryAllowlists<Entity>;
  /**
   * Per-operation overrides. `false` disables the operation; `true`
   * enables one that is off by default (`purgeOne`, `restoreOne`).
   */
  readonly operations?: Partial<Record<StandardOperationId, OperationConfig<Entity> | boolean>>;
}
