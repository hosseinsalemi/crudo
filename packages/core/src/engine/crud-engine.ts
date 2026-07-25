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
import type { StandardOperationId } from "../operations/operation.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { CrudoSettings } from "../config/settings.js";
import { OperationDisabledException, QueryValidationException } from "../errors/exceptions.js";
import { QueryNormalizer } from "../query/query-normalizer.js";
import { createCrudContext, randomUuid } from "../context/default-crud-context.js";
import { mergeSettings } from "../config/merge-settings.js";
import { validateSettings } from "../config/validate-settings.js";
import { resolveSoftDelete } from "../persistence/soft-delete.js";
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

/**
 * Which DTO slot feeds each standard write operation's input. `Partial` is
 * deliberate — reads and the bodyless writes take no input DTO — but the
 * key is the union, so a misspelled id fails the build instead of quietly
 * adding an entry nothing will ever read.
 */
const INPUT_SLOTS: Readonly<Partial<Record<StandardOperationId, DtoSlot>>> = {
  createOne: "create",
  updateOne: "update",
  patchOne: "patch",
};

/**
 * The request pipeline (Phase 7, Template Method over one lifecycle):
 *
 * operation resolution → config resolution → query resolution (reads) →
 * context assembly → DTO resolution → deserialization → handler
 * execution → response mapping → serialization.
 *
 * Query resolution runs ahead of the spec's stage order (which lists it
 * after deserialization) because the context carries the normalized query
 * and deserialization needs the context — architecture doc 07 documents
 * this order as the authoritative one.
 *
 * Every stage boundary is a seam: handlers come from the registry (config
 * and `customOperations` swap them), and the serializer/deserializer,
 * pagination strategies, and include resolver are all constructor-injected
 * — `createCrud` supplies the defaults, callers may supply their own.
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

    // Nothing is special-cased per verb — built-ins are ordinary registry
    // entries (ADR-0006).
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

    // Per-call overrides are parameters, never writes to the frozen
    // resolved config.
    const configView = this.configViewFor(request);

    const query = descriptor.kind === "read" ? this.normalizeQuery(request, configView) : null;
    const context = createCrudContext<Entity>({
      operation: descriptor.id,
      config: configView,
      principal: request.options?.principal,
      transaction: request.options?.transaction ?? null,
      query,
      correlationId,
    });

    const input = this.resolveInput(request, descriptor, context);

    const result = await descriptor.handler.execute(input, context);

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
      // A narrowed scope may change the delete strategy (an operation that
      // forces `hard` on a soft-deletable entity, say), so it is resolved
      // against the settings actually in force for this call.
      softDelete: resolveSoftDelete(this.deps.metadata, settings, `${config.entityName} (${request.operation})`),
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
    // A custom id is simply absent from the table; the cast narrows for the
    // lookup and `noUncheckedIndexedAccess` keeps the miss visible.
    const slot = INPUT_SLOTS[descriptor.id as StandardOperationId];
    const dto = descriptor.input ?? (slot !== undefined ? config.dto.resolve(slot, descriptor.id) : null);

    switch (descriptor.id) {
      case "findOne":
      case "deleteOne":
      case "restoreOne":
      case "purgeOne":
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
      };
    }

    if (result === null || result === undefined) {
      // Void results: deleteOne and purgeOne.
      return { operation: descriptor.id, item: null, list: null };
    }

    const itemDto = (descriptor.output as DtoClass<object> | null) ?? config.dto.resolve("item", descriptor.id);
    return {
      operation: descriptor.id,
      item: serializer.serializeItem(result as Entity, itemDto, context),
      list: null,
    };
  }
}
