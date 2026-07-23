/**
 * Identifier types Crudo accepts for entity primary keys.
 *
 * Composite keys are out of scope for v6; an entity exposes exactly one
 * primary identifier, of one of these types.
 */
export type EntityId = string | number;
