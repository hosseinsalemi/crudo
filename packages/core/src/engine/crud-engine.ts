import type { CrudContext } from "../context/crud-context.js";
import type { CrudRequest } from "../context/crud-request.js";
import type { CrudResponse } from "../context/crud-response.js";
import type { DtoClass, DtoSlot } from "../dto/dto.js";
import type { Deserializer, Serializer } from "../serialization/serializer.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import type { ErrorHandler } from "../errors/crud-exception.js";
import type { NormalizedQueryContext } from "../query/query-context.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationDescriptor, OperationRegistry } from "../operations/operation-registry.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { CrudoSettings } from "../config/settings.js";
import { OperationDisabledException, QueryValidationException } from "../errors/exceptions.js";
import { QueryNormalizer } from "../query/query-normalizer.js";
import { createCrudContext, randomUuid } from "../context/default-crud-context.js";
import { mergeSettings } from "../config/merge-settings.js";
import { validateSettings } from "../config/validate-settings.js";
import type { FindManyResult } from "./built-in-handlers.js";

/**
 * Marker wrapping *raw wire params* (`filter[age][gte]=18` as flat keys).
 * The framework layer (`@crudo/nest`) hands the engine one of these so the
 * full Phase 5 parse-and-coerce pipeline runs; programmatic callers pass a
 * typed `QueryContext` instead, which normalizes without coercion.
 */
export class WireQuery {
  constructor(readonly params: Readonly<Record<string, unknown>>) {}
}

export interface CrudEngineDependencies<Entity extends object> {
  readonly metadata: EntityMetadata<Entity>;
  readonly config: ResolvedEntityConfig<Entity>;
  readonly registry: OperationRegistry<Entity>;
  readonly serializer: Serializer<Entity>;
  readonly deserializer: Deserializer<Entity>;
  readonly normalizer: QueryNormalizer<Entity>;
  readonly errorHandler: ErrorHandler;
}

/** Which DTO slot feeds each standard write operation's input. */
const INPUT_SLOTS: Readonly<Partial<Record<string, DtoSlot>>> = {
  createOne: "create",
  createMany: "create",
  updateOne: "update",
  updateMany: "update",
  patchOne: "patch",
  patchMany: "patch",
};

/**
 * The request pipeline (Phase 7, Template Method over one lifecycle):
 *
 * operation resolution → config resolution → DTO resolution →
 * deserialization → query resolution (reads) → handler execution →
 * response mapping → serialization.
 *
 * Every stage boundary is a seam: handlers come from the registry
 * (Phase 14 swaps them), the serializer/deserializer and pagination
 * strategies are constructor-injected strategies, and the transaction and
 * include stages hold plain defaults until Phases 13/16 land.
 */
export class CrudEngine<Entity extends object> {
  constructor(private readonly deps: CrudEngineDependencies<Entity>) {}

  get registry(): OperationRegistry<Entity> {
    return this.deps.registry;
  }

  get config(): ResolvedEntityConfig<Entity> {
    return this.deps.config;
  }

  async execute(request: CrudRequest<Entity>): Promise<CrudResponse> {
    const { config, errorHandler } = this.deps;
    const correlationId = randomUuid();
    try {
      return await this.run(request, correlationId);
    } catch (error) {
      throw errorHandler.handle(error, {
        entityName: config.entityName,
        operation: request.operation,
        correlationId,
      });
    }
  }

  private async run(request: CrudRequest<Entity>, correlationId: string): Promise<CrudResponse> {
    const { registry, config } = this.deps;

    // 1. Operation resolution — registry lookup, nothing special-cased.
    const descriptor = registry.get(request.operation);
    if (descriptor === undefined || !descriptor.enabled) {
      throw new OperationDisabledException({
        messageParams: {
          operation: request.operation,
          entity: config.entityName,
        },
        context: { entityName: config.entityName, operation: request.operation },
      });
    }

    // 2. Config resolution — per-operation view + per-call overrides
    //    (parameters, never config writes).
    const configView = this.configViewFor(request);

    // 3–5. Query resolution (reads) and context assembly.
    const query = descriptor.kind === "read" ? this.normalizeQuery(request, configView) : null;
    const context = createCrudContext<Entity>({
      operation: descriptor.id,
      config: configView,
      principal: request.options?.principal,
      transaction: request.options?.transaction ?? null,
      query,
      correlationId,
    });

    // 3–4. DTO resolution + deserialization (writes).
    const input = this.resolveInput(request, descriptor, context);

    // 6. Handler execution.
    const result = await descriptor.handler.execute(input, context);

    // 7–8. Response mapping + serialization (DTO mapping → field selection).
    return this.mapResponse(descriptor, result, context);
  }

  private configViewFor(request: CrudRequest<Entity>): ResolvedEntityConfig<Entity> {
    const { config } = this.deps;
    const base = config.settingsFor(request.operation);
    const overrides = request.options?.settings;
    let settings: CrudoSettings = base;
    if (overrides !== undefined) {
      settings = mergeSettings(base, overrides);
      validateSettings(`${config.entityName} (per-call)`, settings);
    }
    if (settings === config.settings) return config;
    return {
      entityName: config.entityName,
      settings,
      settingsFor: () => settings,
      allowlists: config.allowlists,
      dto: config.dto,
      relations: config.relations,
    };
  }

  private normalizeQuery(
    request: CrudRequest<Entity>,
    config: ResolvedEntityConfig<Entity>,
  ): NormalizedQueryContext<Entity> {
    const { normalizer } = this.deps;
    const query = request.query;
    if (query instanceof WireQuery) {
      return normalizer.normalizeWire(query.params, config);
    }
    return normalizer.normalizeInput((query as QueryContext<Entity> | null) ?? undefined, config);
  }

  private resolveInput(
    request: CrudRequest<Entity>,
    descriptor: OperationDescriptor<Entity>,
    context: CrudContext<Entity>,
  ): unknown {
    const { deserializer, config } = this.deps;
    const slot = INPUT_SLOTS[descriptor.id];
    const dto = descriptor.input ?? (slot !== undefined ? config.dto.resolve(slot, descriptor.id) : null);

    switch (descriptor.id) {
      case "findOne":
      case "deleteOne":
        return this.coerceId(request.id);
      case "findMany":
        return null;
      case "updateOne":
      case "patchOne":
        return {
          id: this.coerceId(request.id),
          data: deserializer.deserialize(request.body, dto, context),
        };
      default:
        // createOne and custom operations: the (deserialized) body.
        return deserializer.deserialize(request.body, dto, context);
    }
  }

  /**
   * URL path ids arrive as strings; coerce against the id column's kind so
   * adapters always compare with the right type (and a non-numeric id on a
   * numeric column is a clean 400, not a driver error).
   */
  private coerceId(id: unknown): unknown {
    const { metadata } = this.deps;
    const idField = metadata.fields.find((field) => field.name === metadata.idField);
    if (idField?.kind !== "number" || typeof id !== "string") return id;
    const value = Number(id);
    if (Number.isNaN(value)) {
      throw QueryValidationException.single({
        field: metadata.idField,
        code: "CRUDO_QUERY_INVALID_VALUE",
        detail: `Value '${id}' for field '${metadata.idField}' is not a valid number.`,
      });
    }
    return value;
  }

  private mapResponse(
    descriptor: OperationDescriptor<Entity>,
    result: unknown,
    context: CrudContext<Entity>,
  ): CrudResponse {
    const { serializer, config } = this.deps;

    if (descriptor.id === "findMany") {
      const { entities, total } = result as FindManyResult<Entity>;
      const listDto = (descriptor.output as DtoClass<object> | null) ?? config.dto.resolve("list", descriptor.id);
      const pagination = context.query?.pagination ?? { limit: 0, offset: 0 };
      return {
        operation: descriptor.id,
        item: null,
        list: {
          items: serializer.serializeList(entities, listDto, context),
          limit: pagination.limit,
          offset: pagination.offset,
          total,
          meta: {},
        },
        bulk: null,
      };
    }

    if (result === null || result === undefined) {
      // Void results: deleteOne (and purgeOne once Phase 15 enables it).
      return { operation: descriptor.id, item: null, list: null, bulk: null };
    }

    const itemDto = (descriptor.output as DtoClass<object> | null) ?? config.dto.resolve("item", descriptor.id);
    return {
      operation: descriptor.id,
      item: serializer.serializeItem(result as Entity, itemDto, context),
      list: null,
      bulk: null,
    };
  }
}
