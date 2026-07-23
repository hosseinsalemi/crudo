import type { BulkResultDto } from "../dto/bulk-result.js";
import type { CrudCallOptions } from "./crud-call-options.js";
import type { CrudRequest } from "../context/crud-request.js";
import type { CrudService, IdentifiedInput } from "./crud-service.js";
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
 * Milestone C operations (`*Many`, restore, purge) exist on the interface
 * (contracts are complete since Phase 3) and dispatch like everything
 * else — their registry entries are disabled, so calling one raises
 * `OperationDisabledException` until their phase lands.
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
      ids: null,
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

  async createMany(data: readonly CreateDto[], options?: CrudCallOptions): Promise<BulkResultDto<ItemDto>> {
    const response = await this.engine.execute(
      this.request({
        operation: "createMany",
        body: data as never,
        options: options ?? null,
      }),
    );
    return response.bulk as BulkResultDto<ItemDto>;
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

  async updateMany(
    items: readonly IdentifiedInput<Id, UpdateDto>[],
    options?: CrudCallOptions,
  ): Promise<BulkResultDto<ItemDto>> {
    const response = await this.engine.execute(
      this.request({
        operation: "updateMany",
        body: items as never,
        options: options ?? null,
      }),
    );
    return response.bulk as BulkResultDto<ItemDto>;
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

  async patchMany(
    items: readonly IdentifiedInput<Id, PatchDto>[],
    options?: CrudCallOptions,
  ): Promise<BulkResultDto<ItemDto>> {
    const response = await this.engine.execute(
      this.request({
        operation: "patchMany",
        body: items as never,
        options: options ?? null,
      }),
    );
    return response.bulk as BulkResultDto<ItemDto>;
  }

  async deleteOne(id: Id, options?: CrudCallOptions): Promise<void> {
    await this.engine.execute(this.request({ operation: "deleteOne", id, options: options ?? null }));
  }

  async deleteMany(ids: readonly Id[], options?: CrudCallOptions): Promise<BulkResultDto<Id>> {
    const response = await this.engine.execute(
      this.request({ operation: "deleteMany", ids, options: options ?? null }),
    );
    return response.bulk as BulkResultDto<Id>;
  }

  async restoreOne(id: Id, options?: CrudCallOptions): Promise<ItemDto> {
    const response = await this.engine.execute(this.request({ operation: "restoreOne", id, options: options ?? null }));
    return response.item as ItemDto;
  }

  async restoreMany(ids: readonly Id[], options?: CrudCallOptions): Promise<BulkResultDto<ItemDto>> {
    const response = await this.engine.execute(
      this.request({ operation: "restoreMany", ids, options: options ?? null }),
    );
    return response.bulk as BulkResultDto<ItemDto>;
  }

  async purgeOne(id: Id, options?: CrudCallOptions): Promise<void> {
    await this.engine.execute(this.request({ operation: "purgeOne", id, options: options ?? null }));
  }
}
