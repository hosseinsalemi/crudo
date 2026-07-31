import type { EntityId } from "../types/entity-id.js";
import type { EntityInput } from "../types/utility.js";
import type { QueryContext } from "../query/query-context.js";
import type { ListResultDto } from "../dto/list-result.js";
import type { CrudCallOptions } from "./crud-call-options.js";

/**
 * The primary programmatic surface — what `createCrud(Entity, config)`
 * returns and what generated NestJS routes delegate to.
 *
 * Every generic parameter defaults from `Entity`, so the zero-config path
 * needs no manual arguments (see the generic-parameter table in
 * `docs/architecture/03-core-contracts-and-type-system.md`).
 * Registered DTO classes narrow the corresponding slot.
 *
 * Single-item only. The spec makes batch operations optional and says to
 * drop them when a build does not want them; this build does not, so the
 * `*Many` surface is absent rather than present-but-throwing.
 */
export interface CrudService<
  Entity,
  Id extends EntityId = EntityId,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
> {
  createOne(data: CreateDto, options?: CrudCallOptions): Promise<ItemDto>;

  findOne(id: Id, query?: QueryDto, options?: CrudCallOptions): Promise<ItemDto>;
  findMany(query?: QueryDto, options?: CrudCallOptions): Promise<ListResultDto<ListDto>>;

  updateOne(id: Id, data: UpdateDto, options?: CrudCallOptions): Promise<ItemDto>;

  patchOne(id: Id, data: PatchDto, options?: CrudCallOptions): Promise<ItemDto>;

  /** Hard or soft per the resolved delete strategy. */
  deleteOne(id: Id, options?: CrudCallOptions): Promise<void>;

  /**
   * Un-deletes a soft-deleted row. Reuses the `item` DTO slot — no
   * dedicated restore shape. Enabled when the entity config
   * declares soft delete.
   */
  restoreOne(id: Id, options?: CrudCallOptions): Promise<ItemDto>;

  /**
   * Permanently removes a soft-deleted row; disabled by default, enabled
   * with `operations: { purgeOne: true }`.
   */
  purgeOne(id: Id, options?: CrudCallOptions): Promise<void>;
}
