import type { EntityId } from "../types/entity-id.js";
import type { CrudContext } from "../context/crud-context.js";
import type { NormalizedQueryContext } from "../query/query-context.js";

/**
 * The read half of a repository adapter. Adapters receive only validated,
 * normalized queries — allowlists and limits were enforced upstream
 * (Phase 5), so a reader translates, it never re-validates.
 *
 * Soft-delete exclusion (Phase 15) and include loading (Phase 16) are the
 * reader's concern, driven by `query.withDeleted` / `query.include`.
 */
export interface EntityReader<Entity = unknown, Id extends EntityId = EntityId> {
  /** `null` when nothing matches — "missing vs. error" is the engine's call. */
  findOneById(
    id: Id,
    query: NormalizedQueryContext<Entity> | null,
    context: CrudContext<Entity>,
  ): Promise<Entity | null>;
  /** First match of the query, or `null`. */
  findOne(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<Entity | null>;
  findMany(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<readonly Entity[]>;
  /**
   * Count of all rows matching the query's filter, ignoring pagination.
   * Only called when `query.count` is `true`.
   */
  count(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<number>;
}
