import type { EntityInput } from "../types/utility.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationId } from "../operations/operation.js";

/**
 * Marker for anything usable as a DTO: any non-primitive object shape.
 * DTOs in v6 are shapes for typing, serialization, and Swagger docs —
 * there is no validation subsystem attached to them.
 */
export type Dto = object;

/** A registerable DTO class. DTO classes are plain, no-argument shapes. */
export type DtoClass<Shape extends Dto = Dto> = new () => Shape;

/** The six DTO positions, one per REST verb/context (Phase 4). */
export type DtoSlot = "create" | "update" | "patch" | "query" | "item" | "list";

/**
 * Per-entity DTO registration — the `dto` key of `createCrud`'s config.
 * Every slot is independently optional; an omitted slot falls back to its
 * entity-derived default (derivation rules in Phase 4):
 *
 * | Slot     | Default when omitted                              |
 * | -------- | ------------------------------------------------- |
 * | `create` | Entity, minus generated/relation fields           |
 * | `update` | Same default as `create`                          |
 * | `patch`  | `Partial<update>` if set, else `Partial<Entity>`  |
 * | `query`  | Generic `QueryContext<Entity>`                   |
 * | `item`   | Entity, subject to field selection                |
 * | `list`   | Same as `item`'s resolved type                    |
 *
 * `item` and `list` are split because a list view often wants a leaner
 * projection than a detail view.
 */
export interface OperationDtoMap<
  Entity,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
> {
  readonly create?: DtoClass<CreateDto & Dto>;
  readonly update?: DtoClass<UpdateDto & Dto>;
  readonly patch?: DtoClass<PatchDto & Dto>;
  readonly query?: DtoClass<QueryDto & Dto>;
  readonly item?: DtoClass<ItemDto & Dto>;
  /** Element type inside `ListResultDto.items` — not the envelope. */
  readonly list?: DtoClass<ListDto & Dto>;
}

/**
 * Resolves the effective DTO for a slot on a given operation: the
 * explicitly registered class, or `null` meaning "use the entity-derived
 * default". Resolution is computed once per entity at bootstrap and cached
 * on the resolved config — never per request. Restore and custom
 * operations reuse `item`/`list`; there are no additional slots.
 */
export interface DtoResolver<Entity = unknown> {
  resolve(slot: DtoSlot, operation: OperationId): DtoClass | null;
}
