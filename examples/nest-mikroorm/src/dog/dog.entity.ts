import { Entity, Property } from "@mikro-orm/core";
import { Pet } from "../pet/pet.entity.js";

/**
 * A concrete Pet subtype. Child columns must be nullable under single-table
 * inheritance (rows of sibling types leave them empty).
 */
@Entity({ discriminatorValue: "dog" })
export class Dog extends Pet {
  @Property({ type: "string", nullable: true })
  breed!: string;

  @Property({ type: "boolean", nullable: true })
  goodBoy!: boolean;
}
