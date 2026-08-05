import type { KavoContext } from "../context/kavo-context.js";
import type { KavoRequest } from "../context/kavo-request.js";
import type { KavoResponse } from "../context/kavo-response.js";
import type { DtoClass, DtoSlot } from "../dto/dto.js";
import type { ListMetaDto } from "../dto/list-result.js";
import type { Deserializer, Serializer } from "../serialization/serializer.js";
import type { EntityId } from "../types/entity-id.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import type { EntityReader } from "../persistence/entity-reader.js";
import type { ErrorHandler } from "../errors/kavo-exception-shape.js";
import type { NormalizedQueryContext } from "../query/query-context.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationDescriptor, OperationRegistry } from "../operations/operation-registry.js";
import type { StandardOperationId } from "../operations/operation.js";
import type { RequestPreconditions } from "../caching/etag.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { KavoSettings } from "../config/settings.js";
import {
  OperationDisabledException,
  OperationNotRegisteredException,
  PreconditionFailedException,
  PreconditionUnsupportedException,
  QueryValidationException,
} from "../errors/exceptions.js";
import { nameList } from "../errors/message-hints.js";
import { QueryNormalizer } from "../query/query-normalizer.js";
import { WILDCARD, computeEtag, strongMatch, weakMatch } from "../caching/etag.js";
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
  /**
   * The read half of the entity's adapter, for the one thing a handler
   * cannot do: evaluate an `If-Match` precondition, which needs both a
   * read of the current row *and* the serializer that turns it into the
   * representation the ETag was computed from (ADR-0020). Handlers close
   * over the adapter privately and have no serializer, so the pre-read
   * lives here rather than inside `updateOne`/`patchOne`/`deleteOne`.
   */
  readonly reader: EntityReader<Entity>;
}

/**
 * The standard writes that target one identified row, which is exactly the
 * set whose `If-Match` the engine can evaluate: it re-reads that row and
 * hashes its canonical representation (ADR-0020 §4).
 *
 * `restoreOne`/`purgeOne` are in the set even though they act on a
 * *soft-deleted* row (ADR-0013): the pre-read asks for `withDeleted`, and
 * that flag changes only the filter, never the projection — so the tag it
 * produces is byte-identical to the one `GET /books/1?withDeleted=true`
 * served the client. Leaving them out is what let `DELETE /books/1/purge`
 * accept an `If-Match` and hard-delete anyway.
 *
 * Anything *not* in this set — `createOne`, and every custom operation,
 * whose target nothing in the schema describes — cannot be evaluated, and
 * is refused rather than performed unguarded
 * ({@link PreconditionUnsupportedException}). That is the same reason the
 * table is keyed by `StandardOperationId`.
 */
const PRECONDITION_TARGETS: ReadonlySet<StandardOperationId> = new Set<StandardOperationId>([
  "updateOne",
  "patchOne",
  "deleteOne",
  "restoreOne",
  "purgeOne",
]);

/**
 * Why an `If-Match` could not be evaluated — a closed set, rendered into
 * `KAVO_PRECONDITION_UNSUPPORTED`'s `{reason}` and written here rather
 * than anywhere a caller can reach.
 */
const UNEVALUABLE = {
  notTargeted: "the operation does not target one identified row, so there is no representation to compare against",
  cachingOff: "caching.etag is disabled for it, so no ETag is computed for this entity's representations",
  noCanonicalRead: "findOne is not an enabled operation, so this entity exposes no canonical representation to read",
} as const;

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
 * context assembly → precondition evaluation (`If-Match` writes) → DTO
 * resolution → deserialization → handler execution → response mapping →
 * serialization → ETag / `If-None-Match`.
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

    const preconditions = request.preconditions ?? request.options?.preconditions ?? null;
    // Before the handler, so a failed precondition never reaches the
    // adapter — the check is check-then-write, not compare-and-swap
    // (ADR-0020), and that is exactly why it must be as late as possible
    // and still ahead of the write.
    await this.checkIfMatch(request, descriptor, configView, preconditions, correlationId);

    const input = this.resolveInput(request, descriptor, context);

    const result = await descriptor.handler.execute(input, context);

    return this.mapResponse(descriptor, result, context, preconditions);
  }

  /**
   * `If-Match`: reject the write when the target's current ETag is not one
   * the client named.
   *
   * Three outcomes, and the third is the one worth naming. **Evaluated**
   * for the standard single-row writes: the row is re-read and its
   * canonical tag compared. **Ignored** for reads — `If-Match` is a
   * lost-update guard, a safe method cannot lose an update, and
   * `If-None-Match` is the read-side conditional (ADR-0020 §4).
   * **Refused** for everything else: an unevaluable precondition on a
   * request that changes state is answered with
   * `PreconditionUnsupportedException` rather than a silent `return`,
   * because a client that asked for a guard and did not get one must find
   * out from the response rather than from a lost update.
   *
   * A target with no current representation at all is *not* decided here:
   * the check falls through and the handler raises its own error, so
   * `DELETE` on a soft-deleted row is the same 409 with or without an
   * `If-Match` header. The identity of an error must not depend on whether
   * a cache header was sent.
   */
  private async checkIfMatch(
    request: KavoRequest<Entity>,
    descriptor: OperationDescriptor<Entity>,
    config: ResolvedEntityConfig<Entity>,
    preconditions: RequestPreconditions | null,
    correlationId: string,
  ): Promise<void> {
    const ifMatch = preconditions?.ifMatch;
    if (ifMatch === undefined) return;
    if (descriptor.kind === "read") return;

    const refuse = (reason: string): never => {
      throw new PreconditionUnsupportedException({
        messageParams: { entity: config.entityName, operation: descriptor.id, reason },
        context: { entityName: config.entityName, operation: descriptor.id, correlationId },
      });
    };
    if (!PRECONDITION_TARGETS.has(descriptor.id as StandardOperationId)) refuse(UNEVALUABLE.notTargeted);
    if (!config.settings.caching.etag) refuse(UNEVALUABLE.cachingOff);
    // The 412 below names the current tag, which is only safe to disclose
    // when the client could have read it for itself. No enabled `findOne`
    // means no canonical representation to read — and an unconditional
    // hash in an error message would be an offline oracle over a
    // low-entropy row.
    if (this.deps.registry.get("findOne")?.enabled !== true) refuse(UNEVALUABLE.noCanonicalRead);

    // `*` is "only if it exists", which the pre-read cannot make more or
    // less true — `strongMatch` returns on the wildcard without looking at
    // the tag. Short-circuiting here spares a read, a serialization and a
    // SHA-256 whose answer was a constant, and a target that turns out not
    // to exist still raises from the handler.
    if (ifMatch.includes(WILDCARD)) return;

    const id = this.coerceId(request.id) as EntityId;
    const etag = await this.canonicalEtag(id, request, config, correlationId);
    // No current representation: the row is gone, or an adapter would
    // refuse this write for a reason of its own. Either way the handler
    // owns the answer.
    if (etag === null) return;
    if (strongMatch(ifMatch, etag)) return;
    throw new PreconditionFailedException({
      messageParams: { entity: config.entityName, id: String(id), etag },
      context: { entityName: config.entityName, operation: descriptor.id, correlationId },
    });
  }

  /**
   * The ETag of the target row's **canonical read representation** — what
   * `findOne` on that id with no `fields`/`include`/`sort` params would
   * return. That is the representation a client's `If-Match` token came
   * from, so it is the one the token is compared against; an ETag taken
   * from a field-narrowed read identifies a different representation and
   * will not match (ADR-0020).
   *
   * The pre-read asks for `withDeleted`, which is what makes the check
   * work for `restoreOne`/`purgeOne`: it widens the *filter* and never
   * touches the projection, so a live row hashes exactly as
   * `GET /books/1` would and a soft-deleted one exactly as
   * `GET /books/1?withDeleted=true` would. `null` means the row is not
   * there under any view — the caller lets the handler decide what that
   * is, rather than turning every such case into a 404.
   */
  private async canonicalEtag(
    id: EntityId,
    request: KavoRequest<Entity>,
    config: ResolvedEntityConfig<Entity>,
    correlationId: string,
  ): Promise<string | null> {
    const { reader, serializer, normalizer } = this.deps;
    // `withDeleted` is only a legal query param on a soft-deletable entity
    // — the normalizer rejects it outright otherwise (a client that thinks
    // it is seeing deleted rows should be told it is not), and on a
    // hard-delete entity there is nothing for it to widen anyway.
    const softDeletable = config.softDelete.strategy === "soft";
    const query = normalizer.normalizeInput(softDeletable ? { withDeleted: true } : undefined, config);
    const context = createKavoContext<Entity>({
      operation: "findOne",
      config,
      principal: request.options?.principal,
      transaction: request.options?.transaction ?? null,
      query,
      correlationId,
    });
    const entity = await reader.findOneById(id, query, context);
    if (entity === null) return null;
    const itemDto = config.dto.resolve("item", "findOne") as DtoClass<object> | null;
    return computeEtag(serializer.serializeItem(entity, itemDto, context));
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
      // Structural entity config, outside the settings precedence chain
      // entirely (ADR-0019) — a per-call settings override cannot reach it.
      computed: config.computed,
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

  private async mapResponse(
    descriptor: OperationDescriptor<Entity>,
    result: unknown,
    context: KavoContext<Entity>,
    preconditions: RequestPreconditions | null,
  ): Promise<KavoResponse> {
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
        // Collection ETags are out of scope (issue #120): a list's identity
        // spans pagination, sort and filter, which is a different feature
        // from hashing one representation.
        etag: null,
        notModified: false,
      };
    }

    if (result === null || result === undefined) {
      // Void results: deleteOne and purgeOne.
      return { operation: descriptor.id, item: null, list: null, etag: null, notModified: false };
    }

    const itemDto = (descriptor.output as DtoClass<object> | null) ?? config.dto.resolve("item", descriptor.id);
    const item = serializer.serializeItem(result as Entity, itemDto, context);
    // `context.config` is the per-call view, so `caching.etag` honors an
    // override at any scope down to this one request.
    const etag = context.config.settings.caching.etag ? await computeEtag(item) : null;
    return {
      operation: descriptor.id,
      item,
      list: null,
      etag,
      // `If-None-Match` is a cache-revalidation question, so it is only
      // answered for reads. On a write RFC 9110 gives it "only if absent"
      // semantics, which is a create-conditionally feature this issue
      // deliberately leaves out rather than half-implements.
      notModified: etag !== null && descriptor.kind === "read" && weakMatch(preconditions?.ifNoneMatch ?? [], etag),
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
