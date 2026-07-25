import type { FilterExpression, Filter } from "./filter.js";
import type { FieldSelection, FieldSelectionInput } from "./field-selection.js";
import type { Pagination } from "./pagination.js";
import type { Sort } from "./sort.js";
import type { IncludeTree } from "../relations/include-tree.js";
import type { IncludePath } from "../types/include-path.js";

/**
 * Lenient, caller-facing query input — what a `query` DTO parses into and
 * what programmatic callers pass to `findMany`/`findOne`. Everything is
 * optional; nothing is validated yet.
 *
 * Deliberately split from {@link NormalizedQueryContext}: input is for
 * humans (sparse, forgiving), the normalized form is for the engine and
 * adapters (complete, validated, one canonical shape). The normalization
 * pipeline (Phase 5) is the only path between them.
 */
export interface QueryContext<Entity = unknown> {
  readonly filter?: FilterExpression<Entity> | null;
  readonly sort?: readonly Sort<Entity>[];
  readonly limit?: number;
  readonly offset?: number;
  /** Sparse fieldsets; a bare array is sugar for root-only selection. */
  readonly fields?: FieldSelectionInput<Entity>;
  /**
   * Relation include paths (`['profile', 'posts.comments']`) — Phase 15.
   *
   * Spell-checked against the entity's relation graph. With the default
   * `Entity = unknown` this degrades to `readonly string[]`, so untyped
   * callers are unaffected.
   */
  readonly include?: readonly IncludePath<Entity>[];
  /** Include soft-deleted rows — Phase 14. */
  readonly withDeleted?: boolean;
}

/**
 * The post-normalization query: validated against the entity's allowlists,
 * coerced, limit-enforced, and complete. Lives on `CrudContext.query` for
 * read operations; adapters consume it without re-validating.
 */
export interface NormalizedQueryContext<Entity = unknown> {
  readonly filter: Filter<Entity>;
  readonly sort: readonly Sort<Entity>[];
  readonly pagination: Pagination;
  readonly fields: FieldSelection<Entity>;
  /** Validated include tree; empty object when nothing is included. */
  readonly include: IncludeTree;
  readonly withDeleted: boolean;
  /**
   * Whether the adapter should compute `ListResultDto.total`. `false`
   * skips the count query entirely and the envelope reports `total: null`.
   */
  readonly count: boolean;
}
