import type { ClassRef } from "../types/utility.js";

export type RelationCardinality = "one" | "many";

/**
 * How an included relation is loaded (Phase 15):
 * - `join`  — single query with joins; correct default for to-one.
 * - `batch` — per-level `WHERE parentId IN (…)` queries stitched in
 *   memory; correct default for to-many (avoids row explosion and the
 *   joined-pagination trap).
 * - `auto`  — to-one → `join`, to-many → `batch`.
 */
export type RelationLoadStrategy = "join" | "batch" | "auto";

/**
 * One relation edge of an entity, as registered in its relation registry.
 * Populated from ORM metadata by the adapter, overridable in config.
 */
export interface RelationDescriptor {
  readonly name: string;
  /** Lazy reference to the target entity class (avoids import cycles). */
  readonly target: () => ClassRef;
  readonly cardinality: RelationCardinality;
  /**
   * Whether clients may `include=` this relation. Defaults to `false` —
   * inclusion is an opt-in allowlist, consistent with the filter/sort
   * posture (Phase 5).
   */
  readonly includable: boolean;
  /** Included even when the client doesn't ask. */
  readonly defaultInclude?: boolean;
  /** Overrides the configured `maxIncludeDepth` below this node. */
  readonly maxDepth?: number;
  readonly strategy: RelationLoadStrategy;
}
