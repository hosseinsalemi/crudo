import type { KavoContext } from "../context/kavo-context.js";
import type { KavoRequest } from "../context/kavo-request.js";
import type { KavoResponse } from "../context/kavo-response.js";
import type { DtoClass, DtoSlot } from "../dto/dto.js";
import type { ListMetaDto } from "../dto/list-result.js";
import type { Deserializer, Serializer } from "../serialization/serializer.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import type { ErrorHandler } from "../errors/kavo-exception-shape.js";
import type { NormalizedQueryContext } from "../query/query-context.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationDescriptor, OperationRegistry } from "../operations/operation-registry.js";
import type { StandardOperationId } from "../operations/operation.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { KavoSettings } from "../config/settings.js";
import {
  OperationDisabledException,
  OperationNotRegisteredException,
  QueryValidationException,
} from "../errors/exceptions.js";
import { nameList } from "../errors/message-hints.js";
import { QueryNormalizer } from "../query/query-normalizer.js";
import { createKavoContext, randomUuid } from "../context/default-kavo-context.js";
import { mergeSettings } from "../config/merge-settings.js";
import { validateSettings } from "../config/validate-settings.js";
import { validateDefaultSort } from "../config/resolve-entity-config.js";
import { resolveSoftDelete } from "../persistence/soft-delete.js";
import type { FindManyResult } from "./built-in-handlers.js";

/**
 * Marker wrapping *raw wire params* (`filter[age][gte]=18` as flat keys).
 * The framework layer (`@kavo/nest`) hands the engine one of these so the
 * full parse-and-coerce pipeline runs; programmatic callers pass a
 * typed `QueryContext` instead, which normalizes without coercion.
 */
export class WireQuery {
  constructor(readonly params: Readonly<Record<string, unknown>>) {}
}

export interface KavoEngineDependencies<Entity extends object> {
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
 * The request pipeline (Template Method over one lifecycle):
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
 * swaps them via `operations.<id>.handler`), and the serializer/deserializer,
 * pagination strategies, and include resolver are all constructor-injected
 * — `createCrud` supplies the defaults, callers may supply their own.
 */
export class KavoEngine<Entity extends object> {
  constructor(private readonly deps: KavoEngineDependencies<Entity>) {}

  get registry(): OperationRegistry<Entity> {
    return this.deps.registry;
  }

  get config(): ResolvedEntityConfig<Entity> {
    return this.deps.config;
  }

  async execute(request: KavoRequest<Entity>): Promise<KavoResponse> {
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

  private async run(request: KavoRequest<Entity>, correlationId: string): Promise<KavoResponse> {
    const { registry, config } = this.deps;

    // Nothing is special-cased per verb — built-ins are ordinary registry
    // entries (ADR-0006).
    const descriptor = registry.get(request.operation);
    const errorContext = { entityName: config.entityName, operation: request.operation };
    // A registry miss and a disabled entry are different mistakes with
    // different fixes, so they get different codes (issue #7). Only the
    // disabled branch is reachable over HTTP: route generation walks this
    // same registry, so an unregistered id never gets a route.
    if (descriptor === undefined) {
      throw new OperationNotRegisteredException({
        messageParams: {
          operation: request.operation,
          entity: config.entityName,
          available: registeredIds(registry),
        },
        context: errorContext,
      });
    }
    if (!descriptor.enabled) {
      throw new OperationDisabledException({
        messageParams: {
          operation: request.operation,
          entity: config.entityName,
        },
        context: errorContext,
      });
    }

    // Per-call overrides are parameters, never writes to the frozen
    // resolved config.
    const configView = this.configViewFor(request);

    const query = descriptor.kind === "read" ? this.normalizeQuery(request, configView) : null;
    const context = createKavoContext<Entity>({
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

  private configViewFor(request: KavoRequest<Entity>): ResolvedEntityConfig<Entity> {
    const { config } = this.deps;
    const base = config.settingsFor(request.operation);
    const overrides = request.options?.settings;
    let settings: KavoSettings = base;
    if (overrides !== undefined) {
      settings = mergeSettings(base, overrides);
      const scope = `${config.entityName} (per-call)`;
      validateSettings(scope, settings);
      validateDefaultSort(scope, settings, config.allowlists);
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
    request: KavoRequest<Entity>,
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
    request: KavoRequest<Entity>,
    descriptor: OperationDescriptor<Entity>,
    context: KavoContext<Entity>,
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
      default: {
        // createOne, and any operation id registered outside the standard
        // table (ADR-0006's registry stays generic even without a config
        // surface for adding one): the deserialized body, plus the request
        // id when one is present. createOne never carries an id, so this
        // falls through to the body alone there.
        const body = deserializer.deserialize(request.body, dto, context);
        return request.id === null ? body : { id: this.coerceId(request.id), body };
      }
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
        code: "KAVO_QUERY_INVALID_VALUE",
        detail: `Value '${id}' for field '${metadata.idField}' is not a valid number.`,
      });
    }
    return value;
  }

  private mapResponse(
    descriptor: OperationDescriptor<Entity>,
    result: unknown,
    context: KavoContext<Entity>,
  ): KavoResponse {
    const { serializer, config } = this.deps;

    if (descriptor.id === "findMany") {
      const { entities, total, meta } = result as FindManyResult<Entity>;
      const listDto = (descriptor.output as DtoClass<object> | null) ?? config.dto.resolve("list", descriptor.id);
      const pagination = context.query?.pagination ?? { limit: 0, offset: 0 };
      const listMeta = this.listMeta(meta);
      return {
        operation: descriptor.id,
        item: null,
        list: {
          items: serializer.serializeList(entities, listDto, context),
          limit: pagination.limit,
          offset: pagination.offset,
          // `total` is a required envelope field typed `number | null`, but
          // a custom handler can return `{ entities }` alone. Left
          // `undefined` the key would vanish from the JSON body entirely,
          // so normalize the absent case to the documented `null`.
          total: total ?? null,
          // Spread rather than `meta: listMeta`: assigning `undefined` would
          // leave the key on the object (`"meta" in list`, `Object.keys`)
          // even though `JSON.stringify` drops it, so a programmatic caller
          // and a REST client would disagree about whether the envelope has
          // a `meta`. Omitted means omitted, on both sides.
          ...(listMeta === undefined ? {} : { meta: listMeta }),
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

  /**
   * Assemble the list envelope's `meta` (`ListResultDto.meta` — the
   * response bag, never `OperationConfig.meta`/`OperationMetadata`,
   * ADR-0007).
   *
   * A named step rather than an inline spread because this is the single
   * merge point for everything that can contribute to it, and the handler
   * is only the first contributor: a pagination strategy computing
   * `meta.nextCursor` (#118) belongs to the engine, not to whatever
   * handler happens to be configured, and folds in here.
   *
   * `undefined` — not `{}` — when nothing contributed, so `mapResponse`
   * can leave the key off the envelope entirely. An empty bag carries no
   * information, and the common zero-config list is exactly the case that
   * would pay for it on every response. This is why the field is optional
   * (`ListResultDto.meta?`) while `total` is not: `total: null` still
   * answers "how many matched"; `meta: {}` answers nothing. Emptiness is
   * judged after the merge, so a contributor that returns `{}` is the same
   * as no contributor at all.
   *
   * `meta` never passes through the serializer: it is the caller's own
   * JSON-serializable data, not entity data, so no DTO projection or
   * field selection applies to it and it reaches the wire verbatim.
   *
   * The copy is deliberate, and it is *not* the same situation as `items`:
   * `items` is a fresh array of freshly serialized DTOs on every request,
   * whereas `handlerMeta` can be the very same object each time — a
   * hand-written handler returning a module-scope constant is the
   * documented alternative to `withListMeta`. Handing that object out by
   * reference would let one response's consumer mutate every later
   * response's bag. Shallow is the right depth: it makes the envelope's
   * own key set private without deep-cloning caller data that only has to
   * survive `JSON.stringify`.
   */
  private listMeta(handlerMeta: ListMetaDto | undefined): ListMetaDto | undefined {
    if (handlerMeta === undefined) return undefined;
    const copy = { ...handlerMeta };
    return Object.keys(copy).length === 0 ? undefined : copy;
  }
}

/**
 * Every id the registry knows, sorted, for the not-registered message. The
 * list is short (the standard table plus whatever was registered on top)
 * and it answers "then what *can* I call?" — disabled entries included,
 * since those are one config flag away from working and their own error
 * says so.
 */
function registeredIds<Entity extends object>(registry: OperationRegistry<Entity>): string {
  return nameList(registry.all().map((descriptor) => descriptor.id));
}
