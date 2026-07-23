import { ChildEntity, Column } from "typeorm";
import { Pet } from "./pet.entity.js";

/**
 * A concrete Pet subtype. Child columns must be nullable under single-table
 * inheritance (rows of sibling types leave them empty).
 */
@ChildEntity("dog")
export class Dog extends Pet {
  @Column("varchar", { nullable: true })
  breed!: string;

  @Column("boolean", { nullable: true })
  goodBoy!: boolean;
}
