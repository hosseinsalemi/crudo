import type { KavoContext } from "../context/kavo-context.js";
import type { EntityId } from "../types/entity-id.js";
import type { ListMetaDto } from "../dto/list-result.js";
import type { OperationHandler } from "../operations/operation-handler.js";
import type { RepositoryAdapter } from "../persistence/repository-adapter.js";
import type { StandardOperationId } from "../operations/operation.js";
import type { StandardHandlerFactory } from "../operations/default-operation-registry.js";
import type { NormalizedQueryContext } from "../query/query-context.js";
import { NotFoundException } from "../errors/exceptions.js";
import { hasKeyset } from "../query/pagination.js";

/** What `findMany` hands back to the engine for envelope assembly. */
export interface FindManyResult<Entity> {
  readonly entities: readonly Entity[];
  /** `null` when counting is disabled (`pagination.count: false`). */
  readonly total: number | null;
  /**
   * Extra keys for the list envelope's open metadata bag
   * (`ListResultDto.meta`) — **not** `OperationConfig.meta`
   * (`OperationMetadata`, ADR-0007), which is route/framework metadata on
   * a registry entry.
   *
   * The built-in handler never sets it; an overriding or wrapping handler
   * (see `withListMeta`) does, and the engine merges what it finds here
   * into the envelope instead of discarding it. Optional, so every
   * existing handler stays valid and the field stays additive.
   */
  readonly meta?: ListMetaDto;
  /**
   * Whether at least one more row exists past this page — the has-more
   * signal `meta.nextCursor`/`meta.nextSince` needs, since "null on the
   * last page" cannot be answered by the page itself (ADR-0021, ADR-0022).
   *
   * Only a keyset-paginated path (cursor or since) sets it, by over-fetching
   * `limit + 1` and dropping the sentinel row. Offset paging answers the
   * same question from `total` and leaves this `undefined`.
   */
  readonly hasMore?: boolean;
}

/** Input shape for the id-plus-body operations (update/patch). */
export interface IdentifiedWrite<Entity> {
  readonly id: EntityId;
  readonly data: Partial<Entity>;
}

/**
 * The built-in CRUD behaviors — plain registry entries, nothing
 * special-cased. Each handler is one adapter call plus the "missing vs.
 * error" decision, which is the engine layer's to make: adapters return
 * `null`, handlers turn that into `NotFoundException`.
 */
export function builtInHandlers<Entity extends object>(
  adapter: RepositoryAdapter<Entity>,
): StandardHandlerFactory<Entity> {
  const notFound = (context: KavoContext<Entity>, id: EntityId): never => {
    throw new NotFoundException({
      messageParams: { entity: context.entityName, id: String(id) },
      context: {
        entityName: context.entityName,
        operation: context.operation,
        correlationId: context.correlationId,
      },
    });
  };

  // Total, not `Partial`: every standard operation has a built-in behavior
  // now that the optional batch surface is gone, so a new operation cannot
  // be added without one.
  const handlers: Record<StandardOperationId, OperationHandler<Entity, never, unknown>> = {
    createOne: {
      async execute(input: Partial<Entity>, context: KavoContext<Entity>) {
        return adapter.create(input, context);
      },
    },
    findOne: {
      async execute(id: EntityId, context: KavoContext<Entity>) {
        const entity = await adapter.findOneById(id, context.query, context);
        return entity ?? notFound(context, id);
      },
    },
    findMany: {
      async execute(_input: null, context: KavoContext<Entity>): Promise<FindManyResult<Entity>> {
        const query = context.query;
        if (query === null) {
          throw new Error("findMany requires a normalized query on the context");
        }
        // Over-fetch by one for keyset paging (cursor or since), then drop
        // the sentinel. It lives here rather than in each adapter for two
        // reasons: the four adapters would otherwise implement the same
        // off-by-one four times, and `findMany`'s contract stays "return
        // exactly what the query asks for" — a custom adapter needs no
        // keyset awareness at all beyond honoring `readFilter` (ADR-0021,
        // ADR-0022).
        const keysetPaged = hasKeyset(query.pagination);
        const fetched = await adapter.findMany(keysetPaged ? overFetch(query) : query, context);
        const hasMore = keysetPaged && fetched.length > query.pagination.limit;
        const entities = hasMore ? fetched.slice(0, query.pagination.limit) : fetched;
        // Counting deliberately uses the *unmodified* query: `total` is the
        // size of the whole match set, not of what remains after the
        // cursor/since boundary.
        const total = query.count ? await adapter.count(query, context) : null;
        return keysetPaged ? { entities, total, hasMore } : { entities, total };
      },
    },
    updateOne: {
      async execute(input: IdentifiedWrite<Entity>, context: KavoContext<Entity>) {
        return adapter.update(input.id, input.data, context);
      },
    },
    patchOne: {
      async execute(input: IdentifiedWrite<Entity>, context: KavoContext<Entity>) {
        return adapter.patch(input.id, input.data, context);
      },
    },
    deleteOne: {
      async execute(id: EntityId, context: KavoContext<Entity>) {
        // Hard or soft per `context.config.softDelete` — the strategy is
        // resolved at config time and applied by the adapter,
        // so there is no branch here.
        await adapter.delete(id, context);
        return null;
      },
    },
    restoreOne: {
      async execute(id: EntityId, context: KavoContext<Entity>) {
        // Restore returns the revived row: it reuses the `item` DTO slot,
        // so no new DTO shape enters the system.
        return adapter.restore(id, context);
      },
    },
    purgeOne: {
      async execute(id: EntityId, context: KavoContext<Entity>) {
        await adapter.purge(id, context);
        return null;
      },
    },
  };

  return (id) => handlers[id] as OperationHandler<Entity>;
}

/**
 * The same query, asking for one row more than the page — the sentinel that
 * answers "is there a next page?" without a second query. The envelope still
 * reports `context.query.pagination.limit`, which this copy never touches.
 */
function overFetch<Entity>(query: NormalizedQueryContext<Entity>): NormalizedQueryContext<Entity> {
  return { ...query, pagination: { ...query.pagination, limit: query.pagination.limit + 1 } };
}
