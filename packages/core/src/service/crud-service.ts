import type { EntityId } from "../types/entity-id.js";
import type { EntityInput } from "../types/utility.js";
import type { QueryContext } from "../query/query-context.js";
import type { ListResultDto } from "../dto/list-result.js";
import type { BulkResultDto } from "../dto/bulk-result.js";
import type { CrudCallOptions } from "./crud-call-options.js";

/** One item of an id-carrying batch payload (`updateMany`/`patchMany`). */
export interface IdentifiedInput<Id extends EntityId, Data> {
  readonly id: Id;
  readonly data: Data;
}

/**
 * The primary programmatic surface — what `createCrud(Entity, config)`
 * returns and what generated NestJS routes delegate to.
 *
 * Every generic parameter defaults from `Entity`, so the zero-config path
 * needs no manual arguments (see the generic-parameter table in
 * `packages/docs/architecture/03-core-contracts-and-type-system.md`).
 * Registered DTO classes narrow the corresponding slot.
 *
 * Batch (`*Many`) operations are list-based, never filter-based — no
 * unbounded mass writes. Their availability is a Phase 15 feature; the
 * contract is complete now so later phases never mutate core types.
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
  createMany(data: readonly CreateDto[], options?: CrudCallOptions): Promise<BulkResultDto<ItemDto>>;

  findOne(id: Id, query?: QueryDto, options?: CrudCallOptions): Promise<ItemDto>;
  findMany(query?: QueryDto, options?: CrudCallOptions): Promise<ListResultDto<ListDto>>;

  updateOne(id: Id, data: UpdateDto, options?: CrudCallOptions): Promise<ItemDto>;
  updateMany(
    items: readonly IdentifiedInput<Id, UpdateDto>[],
    options?: CrudCallOptions,
  ): Promise<BulkResultDto<ItemDto>>;

  patchOne(id: Id, data: PatchDto, options?: CrudCallOptions): Promise<ItemDto>;
  patchMany(
    items: readonly IdentifiedInput<Id, PatchDto>[],
    options?: CrudCallOptions,
  ): Promise<BulkResultDto<ItemDto>>;

  /** Hard or soft per the resolved delete strategy (Phase 15). */
  deleteOne(id: Id, options?: CrudCallOptions): Promise<void>;
  deleteMany(ids: readonly Id[], options?: CrudCallOptions): Promise<BulkResultDto<Id>>;

  /** Reuses the `item` DTO slot — no dedicated restore shape (Phase 4). */
  restoreOne(id: Id, options?: CrudCallOptions): Promise<ItemDto>;
  restoreMany(ids: readonly Id[], options?: CrudCallOptions): Promise<BulkResultDto<ItemDto>>;

  /** Permanently removes a soft-deleted row; disabled by default. */
  purgeOne(id: Id, options?: CrudCallOptions): Promise<void>;
}
