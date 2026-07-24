import type { IncludeTree } from "./include-tree.js";
import type { RelationRegistry } from "./relation-registry.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";

/**
 * Turns parsed `include=` dot-paths into a validated {@link IncludeTree}
 * (Phase 15): every edge is checked against the relation registry (unknown
 * or non-includable → `QueryValidationException`, never silently dropped),
 * depth and node-count limits are enforced, and per-node sparse fieldsets
 * are attached. Depth is the cycle guard — the same entity type may repeat
 * on a path; resolution is bounded by depth, never by visited-type
 * tracking.
 */
export interface IncludeResolver<Entity = unknown> {
  resolve(
    paths: readonly string[],
    registry: RelationRegistry<Entity>,
    config: ResolvedEntityConfig<Entity>,
  ): IncludeTree;
}
