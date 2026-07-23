import type { FieldPath } from "../types/field-path.js";

export type SortDirection = "asc" | "desc";

/**
 * One sort criterion. A query carries an ordered list of these — list order
 * is priority order (`sort=-createdAt,name`).
 */
export interface Sort<Entity = unknown> {
  /** Column or allowlisted relation path (`'name'`, `'profile.rating'`). */
  readonly field: FieldPath<Entity>;
  readonly direction: SortDirection;
}
