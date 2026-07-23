import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, TableInheritance } from "typeorm";
// Type-only import + string relation target keep the Owner↔Pet cycle off the
// runtime graph (TypeORM resolves "Owner" by entity name at metadata build).
import type { Owner } from "./owner.entity.js";

/**
 * The single-table inheritance base. `Pet` is never served directly — you
 * cannot create a bare Pet, only a concrete Cat or Dog — so the class is
 * `abstract`. The discriminator column (`species`) has no entity property:
 * it is written automatically by the child repository on insert.
 *
 * The `owner` relation is modeling-only here. Crudo maps every relation to
 * `includable: false` (Phase 16 is unwired), so `include=owner` is still a
 * deferred feature and rejected with a problem-details 400.
 */
/** Enum column shared by every Pet subtype. */
export enum PetSizeEnum {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

@Entity()
@TableInheritance({ column: { type: "varchar", name: "species" } })
export abstract class Pet {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  name!: string;

  @Column("int")
  age!: number;

  // An enum column: the adapter surfaces it as the `enum` FieldKind with its
  // allowed values, so filters coerce against the set.
  @Column({ type: "simple-enum", enum: PetSizeEnum, default: PetSizeEnum.Medium })
  size!: PetSizeEnum;

  @ManyToOne("Owner", (owner: Owner) => owner.pets, { nullable: true })
  owner!: Owner | null;

  @CreateDateColumn()
  createdAt!: Date;
}
