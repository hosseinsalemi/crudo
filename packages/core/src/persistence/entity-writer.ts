import type { EntityId } from "../types/entity-id.js";
import type { CrudContext } from "../context/crud-context.js";

/**
 * The write half of a repository adapter. Writer methods are single-entity
 * primitives — batch (`*Many`) operations are a thin engine-level loop over
 * these plus the bulk envelope (Phase 15), never adapter methods.
 *
 * Writes participate in the ambient transaction on `context.transaction`
 * when one is active (Phase 13); until then they are non-transactional.
 */
export interface EntityWriter<
  Entity = unknown,
  Id extends EntityId = EntityId,
> {
  create(data: Partial<Entity>, context: CrudContext<Entity>): Promise<Entity>;
  /** Full replace (`PUT` semantics — the engine supplies a complete shape). */
  update(
    id: Id,
    data: Partial<Entity>,
    context: CrudContext<Entity>,
  ): Promise<Entity>;
  /** Partial update (`PATCH` semantics — only present keys are written). */
  patch(
    id: Id,
    data: Partial<Entity>,
    context: CrudContext<Entity>,
  ): Promise<Entity>;
  /**
   * Delete by the strategy resolved from config: hard by default, soft
   * when the entity is soft-deletable (Phase 15).
   */
  delete(id: Id, context: CrudContext<Entity>): Promise<void>;
  /** Un-delete a soft-deleted row (Phase 15). */
  restore(id: Id, context: CrudContext<Entity>): Promise<Entity>;
  /** Permanently delete an already-soft-deleted row (Phase 15). */
  purge(id: Id, context: CrudContext<Entity>): Promise<void>;
}
