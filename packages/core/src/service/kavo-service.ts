import type { EntityId } from "../types/entity-id.js";
import type { EntityInput } from "../types/utility.js";
import type { QueryContext } from "../query/query-context.js";
import type { ListResultDto } from "../dto/list-result.js";
import type { DtoInputOf, DtoOutputOf, DtoQueryOf } from "../dto/dto.js";
import type { KavoCallOptions } from "./kavo-call-options.js";

/**
 * The primary programmatic surface — what `createCrud(Entity, config)`
 * returns and what generated NestJS routes delegate to.
 *
 * Every generic parameter defaults from `Entity`, so the zero-config path
 * needs no manual arguments (see the generic-parameter table in
 * `docs/internals/architecture/03-core-contracts-and-type-system.md`).
 * Registered DTO classes narrow the corresponding slot.
 *
 * `Ops` is `EntityConfig`'s inferred `operations` literal (issue #131): each
 * method position reads it through `DtoInputOf`/`DtoOutputOf`/`DtoQueryOf`
 * (`dto.ts`), which fall back to the entity-wide generic above when that
 * operation declares no override — so `findOne`'s response can be typed
 * differently from `createOne`'s even though both default to `ItemDto`.
 *
 * Single-item only. The spec makes batch operations optional and says to
 * drop them when a build does not want them; this build does not, so the
 * `*Many` surface is absent rather than present-but-throwing.
 */
export interface KavoService<
  Entity,
  Id extends EntityId = EntityId,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
  Ops = unknown,
> {
  createOne(
    data: DtoInputOf<Ops, "createOne", CreateDto>,
    options?: KavoCallOptions,
  ): Promise<DtoOutputOf<Ops, "createOne", ItemDto>>;

  findOne(
    id: Id,
    query?: DtoQueryOf<Ops, "findOne", QueryDto>,
    options?: KavoCallOptions,
  ): Promise<DtoOutputOf<Ops, "findOne", ItemDto>>;
  findMany(
    query?: DtoQueryOf<Ops, "findMany", QueryDto>,
    options?: KavoCallOptions,
  ): Promise<ListResultDto<DtoOutputOf<Ops, "findMany", ListDto>>>;

  updateOne(
    id: Id,
    data: DtoInputOf<Ops, "updateOne", UpdateDto>,
    options?: KavoCallOptions,
  ): Promise<DtoOutputOf<Ops, "updateOne", ItemDto>>;

  patchOne(
    id: Id,
    data: DtoInputOf<Ops, "patchOne", PatchDto>,
    options?: KavoCallOptions,
  ): Promise<DtoOutputOf<Ops, "patchOne", ItemDto>>;

  /** Hard or soft per the resolved delete strategy. */
  deleteOne(id: Id, options?: KavoCallOptions): Promise<void>;

  /**
   * Un-deletes a soft-deleted row. Reuses the `item` DTO slot by default —
   * no dedicated restore shape — but `operations.restoreOne.dto.output`
   * still narrows it independently (issue #131). Enabled when the entity
   * config declares soft delete.
   */
  restoreOne(id: Id, options?: KavoCallOptions): Promise<DtoOutputOf<Ops, "restoreOne", ItemDto>>;

  /**
   * Permanently removes a soft-deleted row; disabled by default, enabled
   * with `operations: { purgeOne: true }`.
   */
  purgeOne(id: Id, options?: KavoCallOptions): Promise<void>;
}
