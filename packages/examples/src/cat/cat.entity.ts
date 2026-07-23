import { ChildEntity, Column } from "typeorm";
import { Pet } from "../pet/pet.entity.js";

/**
 * A concrete Pet subtype. Child columns must be nullable under single-table
 * inheritance (rows of sibling types leave them empty).
 */
@ChildEntity("cat")
export class Cat extends Pet {
  @Column("boolean", { nullable: true })
  indoor!: boolean;

  @Column("int", { nullable: true })
  livesLeft!: number;
}
