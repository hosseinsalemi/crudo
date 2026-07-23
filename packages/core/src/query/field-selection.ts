import type { FieldPath } from "../types/field-path.js";

/**
 * Sparse-fieldset selection (`fields=id,name` / `fields[posts]=id,title`).
 *
 * Selection is applied *after* DTO mapping (Phase 4: DTO mapping → field
 * selection), so it can only narrow what the resolved DTO already exposes.
 */
export interface FieldSelection<Entity = unknown> {
  /**
   * Fields of the root resource; `null` means "everything the resolved DTO
   * allows" (no `fields` param sent). Depth 1: root selection addresses own
   * columns — relation shapes are selected via {@link relations}.
   */
  readonly root: readonly FieldPath<Entity, 1>[] | null;
  /**
   * Per-included-relation fieldsets, keyed by relation path as it appeared
   * on the wire (`fields[posts]=…`). Validated against the *target*
   * entity's selectable allowlist (Phase 16).
   */
  readonly relations: Readonly<Record<string, readonly string[]>>;
}
