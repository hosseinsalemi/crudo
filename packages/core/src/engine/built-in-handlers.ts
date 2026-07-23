import type { CrudContext } from "../context/crud-context.js";
import type { EntityId } from "../types/entity-id.js";
import type { OperationHandler } from "../operations/operation-handler.js";
import type { RepositoryAdapter } from "../persistence/repository-adapter.js";
import type { StandardOperationId } from "../operations/operation.js";
import type { StandardHandlerFactory } from "../operations/default-operation-registry.js";
import { NotFoundException } from "../errors/exceptions.js";

/** What `findMany` hands back to the engine for envelope assembly. */
export interface FindManyResult<Entity> {
  readonly entities: readonly Entity[];
  /** `null` when counting is disabled (`pagination.count: false`). */
  readonly total: number | null;
}

/** Input shape for the id-plus-body operations (update/patch). */
export interface IdentifiedWrite<Entity> {
  readonly id: EntityId;
  readonly data: Partial<Entity>;
}

/**
 * The built-in CRUD behaviors (Phase 7) — plain registry entries, nothing
 * special-cased. Each handler is one adapter call plus the "missing vs.
 * error" decision, which is the engine layer's to make: adapters return
 * `null`, handlers turn that into `NotFoundException`.
 */
export function builtInHandlers<Entity extends object>(
  adapter: RepositoryAdapter<Entity>,
): StandardHandlerFactory<Entity> {
  const notFound = (context: CrudContext<Entity>, id: EntityId): never => {
    throw new NotFoundException({
      messageParams: { entity: context.entityName, id: String(id) },
      context: {
        entityName: context.entityName,
        operation: context.operation,
        correlationId: context.correlationId,
      },
    });
  };

  const handlers: Partial<Record<StandardOperationId, OperationHandler<Entity, never, unknown>>> = {
    createOne: {
      async execute(input: Partial<Entity>, context: CrudContext<Entity>) {
        return adapter.create(input, context);
      },
    },
    findOne: {
      async execute(id: EntityId, context: CrudContext<Entity>) {
        const entity = await adapter.findOneById(id, context.query, context);
        return entity ?? notFound(context, id);
      },
    },
    findMany: {
      async execute(_input: null, context: CrudContext<Entity>): Promise<FindManyResult<Entity>> {
        const query = context.query;
        if (query === null) {
          throw new Error("findMany requires a normalized query on the context");
        }
        const entities = await adapter.findMany(query, context);
        const total = query.count ? await adapter.count(query, context) : null;
        return { entities, total };
      },
    },
    updateOne: {
      async execute(input: IdentifiedWrite<Entity>, context: CrudContext<Entity>) {
        return adapter.update(input.id, input.data, context);
      },
    },
    patchOne: {
      async execute(input: IdentifiedWrite<Entity>, context: CrudContext<Entity>) {
        return adapter.patch(input.id, input.data, context);
      },
    },
    deleteOne: {
      async execute(id: EntityId, context: CrudContext<Entity>) {
        await adapter.delete(id, context);
        return null;
      },
    },
  };

  return (id) => {
    const handler = handlers[id];
    if (handler === undefined) {
      // Milestone C operations (`*Many`, restore, purge) are registered
      // disabled; their handlers are unreachable until those phases bind
      // real ones.
      return {
        execute(): Promise<never> {
          throw new Error(`operation '${id}' has no built-in behavior yet`);
        },
      };
    }
    return handler as OperationHandler<Entity>;
  };
}
