import type { RelationDescriptor } from "./relation-descriptor.js";

/**
 * Per-entity registry of relation edges. Selectable/filterable/
 * sortable fields of an included node come from the *target* entity's own
 * config — a relation never widens what its target exposes.
 */
export interface RelationRegistry<_Entity = unknown> {
  get(name: string): RelationDescriptor | undefined;
  has(name: string): boolean;
  all(): readonly RelationDescriptor[];
}
