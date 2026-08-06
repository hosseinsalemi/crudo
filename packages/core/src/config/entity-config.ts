import type { KavoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { FieldPath } from "../types/field-path.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationDtoMap, OperationDtoOverride } from "../dto/dto.js";
import type { EntityInput } from "../types/utility.js";
import type { OperationHandler, OperationMetadata } from "../operations/operation-handler.js";
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
 *
 * `DtoOverride` is `StandardOperationsConfig`'s per-id `Pick` of
 * `OperationDtoOverride` — only the fields that operation actually
 * supports (issue #131). It defaults to the full override shape so a bare
 * `OperationConfig<Entity>` (used where no specific operation id is in
 * scope) still type-checks.
 */
export interface OperationConfig<Entity = unknown, DtoOverride = OperationDtoOverride> extends Omit<
  DeepPartial<KavoSettings>,
  "operations"
> {
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
  /**
   * Overrides the entity's root `dto` slot for this operation only —
   * `input`/`output`/`query` as applicable to the operation's shape.
   * Fallback order: this field → the entity's root `dto.<slot>` →
   * entity-derived default (doc 04 §8).
   */
  readonly dto?: DtoOverride;
}

/**
 * The `operations` map's per-id DTO override shapes (issue #131): each
 * standard operation `Pick`s only the `OperationDtoOverride` fields it
 * actually has — a write op gets `input`/`output`, a read gets
 * `output`/`query`, and `deleteOne`/`purgeOne` (void results, no query)
 * get neither, so setting `dto` on them is a type error before it is ever
 * a bootstrap one. `false`/`true` (the enable/disable shorthand) is still
 * accepted at every id, unchanged.
 *
 * Unlike the root `dto` map, a per-operation override is **not** narrowed
 * against the entity's own `CreateDto`/`ItemDto`/etc. — those generics are
 * inferred from the root `dto` slots alone, so constraining an override to
 * them here would force it to structurally equal the *default* (usually
 * `Entity` itself) instead of letting the registered class's own shape
 * flow through to `KavoService`'s `Ops`-based positions (`DtoInputOf`/
 * `DtoOutputOf`/`DtoQueryOf`, `dto.ts`). Each field is simply `DtoClass<Dto>`
 * — any class — which is what lets `AuthorProfileDto` (fewer fields than
 * `Author`) narrow `findOne`'s response independently of `createOne`'s.
 */
export interface StandardOperationsConfig<
  Entity,
  // Unused by this interface's own fields (see the comment above) — kept as
  // generic parameters, `_`-prefixed where the linter would otherwise flag
  // them as unused, purely so `EntityConfig`'s
  // `Ops extends StandardOperationsConfig<Entity, CreateDto, ..., ListDto>`
  // constraint keeps the same shape it always has; the DTO generics stay
  // meaningful for the *root* `dto` map, just not for this per-operation one.
  _CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  _PatchDto = Partial<UpdateDto>,
  _QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  _ListDto = ItemDto,
> {
  readonly createOne?: OperationConfig<Entity, Pick<OperationDtoOverride, "input" | "output">> | boolean;
  readonly findOne?: OperationConfig<Entity, Pick<OperationDtoOverride, "output" | "query">> | boolean;
  readonly findMany?: OperationConfig<Entity, Pick<OperationDtoOverride, "output" | "query">> | boolean;
  readonly updateOne?: OperationConfig<Entity, Pick<OperationDtoOverride, "input" | "output">> | boolean;
  readonly patchOne?: OperationConfig<Entity, Pick<OperationDtoOverride, "input" | "output">> | boolean;
  /** Void result, no query — no `dto` override is representable. */
  readonly deleteOne?: OperationConfig<Entity, never> | boolean;
  readonly restoreOne?: OperationConfig<Entity, Pick<OperationDtoOverride, "output">> | boolean;
  /** Void result, no query — no `dto` override is representable. */
  readonly purgeOne?: OperationConfig<Entity, never> | boolean;
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
  // The constraint fixes the shape `operations` accepts; the free
  // parameter is what lets inference capture the *literal* dto classes a
  // caller registers per operation, which `DtoInputOf`/`DtoOutputOf`/
  // `DtoQueryOf` (dto.ts) then read back off `KavoService`'s `Ops`
  // parameter (issue #131) — the same "constrain, don't fix" shape
  // `allowlists.selectable`'s `NoInfer<Computed>` already relies on.
  Ops extends StandardOperationsConfig<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto> =
    StandardOperationsConfig<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>,
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
   * enables one that is off by default (`purgeOne`, `restoreOne`); an
   * object form may also carry a per-operation `dto` override
   * (`StandardOperationsConfig`, above).
   */
  readonly operations?: Ops;
}
