import type { KavoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { FieldPath } from "../types/field-path.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationDtoMap } from "../dto/dto.js";
import type { EntityInput } from "../types/utility.js";
import type { OperationHandler, OperationMetadata } from "../operations/operation-handler.js";
import type { StandardOperationId } from "../operations/operation.js";
import type { ComputedFieldDescriptor } from "./computed-field.js";

/**
 * One allowlist key's raw configuration: either the explicit set of paths
 * to allow, or `{ exclude }` — every own column except the ones named.
 * `exclude` is resolved against the entity's own columns at bootstrap
 * (`resolveAllowlists`), never evaluated eagerly here — the `@Kavo(...)`
 * config object is built at class-decoration time, before any ORM metadata
 * exists (ADR-0013), so there is nothing to resolve `exclude` against yet.
 *
 * `Extra` widens both forms with names that are not paths on the entity —
 * only ever the entity's declared computed-field names, and only on
 * `selectable` (ADR-0019).
 */
export type QueryFieldSelector<Entity, Extra extends string = never> =
  readonly (FieldPath<Entity> | Extra)[] | { readonly exclude: readonly (FieldPath<Entity> | Extra)[] };

/**
 * Security allowlists: what a request may filter, sort, and
 * select on — including relation paths. Anything outside an allowlist is
 * rejected with a 400 (`QueryValidationException`), never silently
 * dropped. When omitted, the allowlists derive from the `query` DTO or
 * entity metadata at bootstrap.
 *
 * `selectable` is the only key computed-field names may appear in:
 * `filterable`/`sortable` stay typed to real paths, because a computed
 * field has no column to translate to `WHERE`/`ORDER BY` (ADR-0019). The
 * bootstrap check in `resolveAllowlists` catches the same mistake from an
 * erased or cast config, where the type is not there to help.
 */
export interface QueryAllowlists<Entity = unknown, Computed extends string = never> {
  readonly filterable?: QueryFieldSelector<Entity>;
  readonly sortable?: QueryFieldSelector<Entity>;
  readonly selectable?: QueryFieldSelector<Entity, Computed>;
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
 *
 * `Computed` is inferred from the keys of `computed` and exists so an
 * explicit `allowlists.selectable` list can name a computed field without
 * a cast; every other position stays typed to real entity paths.
 */
export interface EntityConfig<
  Entity,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
  Computed extends string = never,
> extends Omit<DeepPartial<KavoSettings>, "operations"> {
  readonly dto?: OperationDtoMap<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>;
  /**
   * Computed (virtual) response fields, keyed by the name each serializes
   * as — structural entity-scope config like `dto`, deliberately outside
   * the settings precedence chain because it carries functions (ADR-0019).
   * Declared fields join the entity-derived `item`/`list` projection and
   * the `selectable` allowlist automatically; they are never filterable,
   * sortable, or writable.
   */
  readonly computed?: Readonly<Record<Computed, ComputedFieldDescriptor<Entity>>>;
  readonly allowlists?: QueryAllowlists<Entity, NoInfer<Computed>>;
  /**
   * Per-operation overrides. `false` disables the operation; `true`
   * enables one that is off by default (`purgeOne`, `restoreOne`).
   */
  readonly operations?: Partial<Record<StandardOperationId, OperationConfig<Entity> | boolean>>;
}
