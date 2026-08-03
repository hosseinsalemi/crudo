import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
// Type-only import + string relation target, same reasoning as
// `pet.entity.ts`: the Owner↔Address cycle stays off the runtime graph.
import type { Owner } from "../owner/owner.entity.js";

/**
 * The inverse side of the example's one-to-one relation: `Owner` owns the
 * join column (`owner.entity.ts`), so `Address` never writes an owner
 * through its own routes — it only carries the inverse property MikroORM
 * needs to resolve the mapping.
 */
@Entity()
export class Address {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  street!: string;

  @Property({ type: "string" })
  city!: string;

  @Property({ type: "string" })
  postalCode!: string;

  @OneToOne("Owner", undefined, { mappedBy: "address", nullable: true })
  owner: Owner | null = null;
}
