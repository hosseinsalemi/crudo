import type { RelationLoadStrategy } from "../relations/relation-descriptor.js";
import type { StandardOperationId } from "../operations/operation.js";
import type { Sort } from "../query/sort.js";

/**
 * The complete, canonical settings schema — one schema for every scope.
 *
 * These interfaces describe *resolved* (complete) settings. Input scopes —
 * global (`createKavo`), entity (`createCrud`), operation, and per-call —
 * all accept `DeepPartial<KavoSettings>` of this same shape; there is
 * never a second config mechanism (schema-extensibility rule).
 * Later features add keys here, reserved in the schema now.
 */

/** Built-in pagination strategy names; open for custom strategies. */
export type PaginationStrategyName = "offset" | "page" | (string & {});

export interface PaginationSettings {
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly strategy: PaginationStrategyName;
  /** Whether list responses compute `total` (the count query). */
  readonly count: boolean;
}

export interface QuerySettings {
  /** Max nesting depth of the filter AST. */
  readonly maxFilterDepth: number;
  /** Max array length for `IN`/`NOT_IN`/`BETWEEN` values. */
  readonly maxInValues: number;
  /**
   * Order applied when a request supplies no `sort` — a client-supplied
   * `sort` always wins outright, never merges with this. Fields are
   * validated against the sortable allowlist at bootstrap, the same as
   * client-supplied sort fields are at request time.
   */
  readonly defaultSort: readonly Sort[];
}

export interface ErrorSettings {
  /** Leak driver-level error details into responses — off by default. */
  readonly exposeInternals: boolean;
}

/**
 * Per-relation configuration — the config half of a
 * `RelationDescriptor`. ORM metadata supplies shape (name, target,
 * cardinality); this supplies *permission*, which metadata can never know.
 */
export interface RelationEdgeSettings {
  /** Whether clients may `include=` this relation. Defaults to `false`. */
  readonly includable?: boolean;
  /** Included even when the client doesn't ask. */
  readonly defaultInclude?: boolean;
  /** Overrides `maxIncludeDepth` for the subtree below this node. */
  readonly maxDepth?: number;
  readonly strategy?: RelationLoadStrategy;
}

/** Relation inclusion limits and the per-relation allowlist. */
export interface RelationSettings {
  readonly maxIncludeDepth: number;
  readonly maxIncludedNodes: number;
  /**
   * Per-relation overrides, keyed by relation property name. Inclusion is
   * opt-in: a relation absent here is not includable.
   */
  readonly edges: Readonly<Record<string, RelationEdgeSettings>>;
}

/**
 * How the delete strategy is chosen. `auto` — the default —
 * resolves per entity: soft when it carries the delete-marker field, hard
 * otherwise, so entities that aren't soft-deletable cost nothing. `soft`
 * and `hard` state the strategy outright; `soft` on an entity without a
 * marker field fails at bootstrap.
 */
export type SoftDeleteMode = "auto" | "soft" | "hard";

/** Soft delete. `false` at any scope disables it entirely. */
export interface SoftDeleteSettings {
  /** Delete-marker field name (`deletedAt: Date | null` convention). */
  readonly field: string;
  readonly strategy: SoftDeleteMode;
}

/** The full settings tree. */
export interface KavoSettings {
  readonly pagination: PaginationSettings;
  readonly query: QuerySettings;
  readonly errors: ErrorSettings;
  readonly relations: RelationSettings;
  readonly softDelete: SoftDeleteSettings | false;
  /**
   * Global operation enablement, keyed by standard operation id — booleans
   * only, unlike the richer per-entity `EntityConfig.operations` (which also
   * carries `handler`/`meta` and is entity-typed). An id absent here defers
   * to the built-in default (and, for `restoreOne`, ADR-0013's soft-delete
   * auto-enable); an entity's own `operations.<id>` always wins over this.
   */
  readonly operations: Readonly<Partial<Record<StandardOperationId, boolean>>>;
}
