import { Column, Entity, OneToOne, PrimaryGeneratedColumn } from "typeorm";
// Type-only import + string relation target keep the Owner↔Address cycle off
// the runtime graph, same as Owner↔Pet (see owner.entity.ts).
import type { Owner } from "../owner/owner.entity.js";

/**
 * The inverse side of the example's first one-to-one relation: `Owner` owns
 * the join column (`owner.entity.ts`), so `Address` never writes an owner
 * through its own routes — it only carries the inverse property TypeORM
 * needs to resolve the mapping.
 */
@Entity()
export class Address {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  street!: string;

  @Column("varchar")
  city!: string;

  @Column("varchar")
  postalCode!: string;

  @OneToOne("Owner", (owner: Owner) => owner.address, { nullable: true })
  owner!: Owner | null;
}
