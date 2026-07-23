import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
// Type-only import + string relation target keep the Owner↔Pet cycle off the
// runtime graph (TypeORM resolves "Pet" by entity name at metadata build).
import type { Pet } from "../pet/pet.entity.js";

/**
 * The relation side of the example: an Owner has many Pets. Explicit
 * column types keep the entity independent of `emitDecoratorMetadata`.
 */
@Entity()
export class Owner {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  name!: string;

  @Column("varchar", { unique: true })
  email!: string;

  // A nullable, client-writable date column (unlike the generated createdAt).
  @Column("datetime", { nullable: true })
  startedAt!: Date | null;

  @OneToMany("Pet", (pet: Pet) => pet.owner)
  pets!: Pet[];

  @CreateDateColumn()
  createdAt!: Date;
}
