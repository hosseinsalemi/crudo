import { Entity, Property } from "@mikro-orm/core";
import { Pet } from "../pet/pet.entity.js";

/**
 * A concrete Pet subtype. Child columns must be nullable under single-table
 * inheritance (rows of sibling types leave them empty).
 *
 * `extends Pet` is a real runtime import, but it is one-directional —
 * `pet.entity.ts` never imports its subtypes, because `discriminatorValue`
 * on the child is what registers the mapping, not a `discriminatorMap` on
 * the base. That is what keeps this edge acyclic.
 */
@Entity({ discriminatorValue: "cat" })
export class Cat extends Pet {
  @Property({ type: "boolean", nullable: true })
  indoor!: boolean;

  @Property({ type: "number", nullable: true })
  livesLeft!: number;
}
