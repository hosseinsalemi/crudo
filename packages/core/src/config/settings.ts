/**
 * The complete, canonical settings schema — one schema for every scope.
 *
 * These interfaces describe *resolved* (complete) settings. Input scopes —
 * global (`createCrudo`), entity (`createCrud`), operation, and per-call —
 * all accept `DeepPartial<CrudoSettings>` of this same shape; there is
 * never a second config mechanism (Phase 8 schema-extensibility rule).
 * Later feature phases add keys here, reserved in the schema now.
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
}

export interface ErrorSettings {
  /** Leak driver-level error details into responses — off by default. */
  readonly exposeInternals: boolean;
}

/** Reserved for Phase 15 (nested includes). */
export interface RelationSettings {
  readonly maxIncludeDepth: number;
  readonly maxIncludedNodes: number;
}

/**
 * How the delete strategy is chosen (Phase 14). `auto` — the default —
 * resolves per entity: soft when it carries the delete-marker field, hard
 * otherwise, so entities that aren't soft-deletable cost nothing. `soft`
 * and `hard` state the strategy outright; `soft` on an entity without a
 * marker field fails at bootstrap.
 */
export type SoftDeleteMode = "auto" | "soft" | "hard";

/** Soft delete (Phase 14). `false` at any scope disables it entirely. */
export interface SoftDeleteSettings {
  /** Delete-marker field name (`deletedAt: Date | null` convention). */
  readonly field: string;
  readonly strategy: SoftDeleteMode;
}

/** Reserved for Phase 14 (bulk). */
export type BulkMode = "atomic" | "bestEffort";

export interface BulkSettings {
  readonly mode: BulkMode;
  readonly maxBatchSize: number;
}

/** The full settings tree. */
export interface CrudoSettings {
  readonly pagination: PaginationSettings;
  readonly query: QuerySettings;
  readonly errors: ErrorSettings;
  readonly relations: RelationSettings;
  readonly softDelete: SoftDeleteSettings | false;
  readonly bulk: BulkSettings;
}
