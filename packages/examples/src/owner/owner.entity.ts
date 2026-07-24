import type { SoftDeletable } from "@crudo/core";
import { Column, CreateDateColumn, DeleteDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
// Type-only import + string relation target keep the Owner↔Pet cycle off the
// runtime graph (TypeORM resolves "Pet" by entity name at metadata build).
import type { Pet } from "../pet/pet.entity.js";

/**
 * The relation side of the example: an Owner has many Pets. Explicit
 * column types keep the entity independent of `emitDecoratorMetadata`.
 *
 * Owners are soft-deletable: `@DeleteDateColumn` is all the ORM needs to
 * say so, and `@crudo/typeorm` surfaces it as the delete-marker field, so
 * `DELETE /owners/:id` stamps the row instead of removing it (Phase 14).
 *
 * Caveat worth seeing in a reference app: a soft-deleted owner still
 * occupies the unique `email` index, so re-creating one after deleting it
 * is a 409 until the index is made partial
 * (`… ON owner (email) WHERE deletedAt IS NULL`).
 */
@Entity()
export class Owner implements SoftDeletable {
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

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
