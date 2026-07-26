import type { SoftDeletable } from "@kavo/core";
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
// Type-only import + string relation target keep the Owner↔Pet cycle off the
// runtime graph (TypeORM resolves "Pet" by entity name at metadata build).
import type { Pet } from "../pet/pet.entity.js";
// Same reasoning for Owner↔Address.
import type { Address } from "../address/address.entity.js";

/**
 * The relation side of the example: an Owner has many Pets. Explicit
 * column types keep the entity independent of `emitDecoratorMetadata`.
 *
 * Owners are soft-deletable: `@DeleteDateColumn` is all the ORM needs to
 * say so, and `@kavo/typeorm` surfaces it as the delete-marker field, so
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

  // The owning side of the one-to-one: Owner carries the (nullable, unique)
  // join column. `@JoinColumn` is required explicitly here — unlike
  // `@ManyToOne`, a one-to-one owning side does not get one implicitly.
  @OneToOne("Address", (address: Address) => address.owner, { nullable: true })
  @JoinColumn()
  address!: Address | null;

  @CreateDateColumn()
  createdAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
