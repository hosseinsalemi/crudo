import type { CrudCallOptions } from "./crud-call-options.js";
import type { CrudRequest } from "../context/crud-request.js";
import type { CrudService } from "./crud-service.js";
import type { EntityId } from "../types/entity-id.js";
import type { EntityInput } from "../types/utility.js";
import type { ListResultDto } from "../dto/list-result.js";
import type { OperationId } from "../operations/operation.js";
import type { QueryContext } from "../query/query-context.js";
import { CrudEngine } from "../engine/crud-engine.js";

/**
 * The programmatic surface bound to one entity's engine — what
 * `createCrud` returns. Methods are sugar over the engine's transport-
 * agnostic `CrudRequest`/`CrudResponse` envelopes; generated NestJS routes
 * delegate to the same engine, so both paths run the identical pipeline.
 *
 * Soft-delete operations (restore, purge) dispatch like everything else;
 * their registry entries are enabled from config, so calling one on an
 * entity that does not declare soft delete raises
 * `OperationDisabledException`.
 */
export class DefaultCrudService<
  Entity extends object,
  Id extends EntityId = EntityId,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
> implements CrudService<Entity, Id, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto> {
  constructor(readonly engine: CrudEngine<Entity>) {}

  private request(partial: Partial<CrudRequest<Entity>> & { operation: OperationId }): CrudRequest<Entity> {
    return {
      id: null,
      body: null,
      query: null,
      options: null,
      ...partial,
    } as CrudRequest<Entity>;
  }

  async createOne(data: CreateDto, options?: CrudCallOptions): Promise<ItemDto> {
    const response = await this.engine.execute(
      this.request({
        operation: "createOne",
        body: data as never,
        options: options ?? null,
      }),
    );
    return response.item as ItemDto;
  }

  async findOne(id: Id, query?: QueryDto, options?: CrudCallOptions): Promise<ItemDto> {
    const response = await this.engine.execute(
      this.request({
        operation: "findOne",
        id,
        query: (query ?? null) as never,
        options: options ?? null,
      }),
    );
    return response.item as ItemDto;
  }

  async findMany(query?: QueryDto, options?: CrudCallOptions): Promise<ListResultDto<ListDto>> {
    const response = await this.engine.execute(
      this.request({
        operation: "findMany",
        query: (query ?? null) as never,
        options: options ?? null,
      }),
    );
    return response.list as ListResultDto<ListDto>;
  }

  async updateOne(id: Id, data: UpdateDto, options?: CrudCallOptions): Promise<ItemDto> {
    const response = await this.engine.execute(
      this.request({
        operation: "updateOne",
        id,
        body: data as never,
        options: options ?? null,
      }),
    );
    return response.item as ItemDto;
  }

  async patchOne(id: Id, data: PatchDto, options?: CrudCallOptions): Promise<ItemDto> {
    const response = await this.engine.execute(
      this.request({
        operation: "patchOne",
        id,
        body: data as never,
        options: options ?? null,
      }),
    );
    return response.item as ItemDto;
  }

  async deleteOne(id: Id, options?: CrudCallOptions): Promise<void> {
    await this.engine.execute(this.request({ operation: "deleteOne", id, options: options ?? null }));
  }

  async restoreOne(id: Id, options?: CrudCallOptions): Promise<ItemDto> {
    const response = await this.engine.execute(this.request({ operation: "restoreOne", id, options: options ?? null }));
    return response.item as ItemDto;
  }

  async purgeOne(id: Id, options?: CrudCallOptions): Promise<void> {
    await this.engine.execute(this.request({ operation: "purgeOne", id, options: options ?? null }));
  }
}
