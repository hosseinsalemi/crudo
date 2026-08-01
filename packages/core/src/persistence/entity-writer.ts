import type { EntityId } from "../types/entity-id.js";
import type { KavoContext } from "../context/kavo-context.js";

/**
 * The write half of a repository adapter. Writer methods are single-entity
 * primitives. Were the spec's optional batch surface ever built, it would
 * be an engine-level loop over these — never new adapter methods.
 *
 * Writes participate in the ambient transaction on `context.transaction`
 * when one is active; until an adapter supplies one they are
 * non-transactional.
 */
export interface EntityWriter<Entity = unknown, Id extends EntityId = EntityId> {
  create(data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity>;
  /** Full replace (`PUT` semantics — the engine supplies a complete shape). */
  update(id: Id, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity>;
  /** Partial update (`PATCH` semantics — only present keys are written). */
  patch(id: Id, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity>;
  /**
   * Delete by the strategy on `context.config.softDelete`:
   * hard by default, soft when the entity carries a delete-marker field.
   * Soft-deleting an already-deleted row raises `AlreadyDeletedException`.
   */
  delete(id: Id, context: KavoContext<Entity>): Promise<void>;
  /**
   * Un-delete a soft-deleted row and return it. A row that is not deleted
   * raises `NotDeletedException`; a missing one, `NotFoundException`.
   */
  restore(id: Id, context: KavoContext<Entity>): Promise<Entity>;
  /**
   * Permanently delete an already-soft-deleted row. Under a hard delete
   * strategy this is just a delete — the row is gone either way.
   */
  purge(id: Id, context: KavoContext<Entity>): Promise<void>;
}
