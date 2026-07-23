import type { RelationDescriptor } from "./relation-descriptor.js";

/** One validated node of an include tree. */
export interface IncludeNode {
  readonly relation: RelationDescriptor;
  /**
   * Sparse fieldset for this node (`fields[posts]=id,title`), validated
   * against the target entity's selectable allowlist; `null` = all fields
   * the target's resolved DTO allows. Keys needed for stitching are always
   * fetched internally and stripped at serialization if not selected.
   */
  readonly fields: readonly string[] | null;
  readonly children: IncludeTree;
}

/**
 * A validated relation-inclusion tree, keyed by relation name. Produced by
 * `IncludeResolver` from parsed `include=` paths; overlapping paths merge
 * (`posts` + `posts.comments` → one `posts` node with a `comments` child).
 * Adapters consume it without re-validating. Empty object = no includes.
 */
export type IncludeTree = Readonly<Record<string, IncludeNode>>;
