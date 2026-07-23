import type { CrudoSettings } from "./settings.js";
import type { FieldPath } from "../types/field-path.js";
import type { DtoResolver } from "../dto/dto.js";
import type { OperationId } from "../operations/operation.js";
import type { RelationRegistry } from "../relations/relation-registry.js";

/** Allowlists after bootstrap resolution — complete, never optional. */
export interface ResolvedQueryAllowlists<Entity = unknown> {
  readonly filterable: readonly FieldPath<Entity>[];
  readonly sortable: readonly FieldPath<Entity>[];
  readonly selectable: readonly FieldPath<Entity>[];
}

/**
 * The frozen, fully-merged configuration for one entity — the product of
 * the precedence chain `built-in defaults → global → entity → operation`
 * (per-call overrides are parameters, not config writes).
 *
 * All merging happens once at bootstrap; the result is immutable. Invalid
 * config fails fast at bootstrap with an error naming the entity, the key
 * path, and the offending value (Phase 8).
 */
export interface ResolvedEntityConfig<Entity = unknown> {
  readonly entityName: string;
  /** Entity-scope settings (global already merged in). */
  readonly settings: CrudoSettings;
  /** Per-operation settings view: entity settings + operation overrides. */
  settingsFor(operation: OperationId): CrudoSettings;
  readonly allowlists: ResolvedQueryAllowlists<Entity>;
  /** Bootstrap-cached DTO resolution (Phase 4). */
  readonly dto: DtoResolver<Entity>;
  /** Relation edges of this entity (Phase 16). */
  readonly relations: RelationRegistry<Entity>;
}
