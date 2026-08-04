import { Collection } from "@mikro-orm/core";
import { Entity, Enum, ManyToMany, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";
// Type-only imports + string relation targets keep the Owner↔Pet cycle off
// the runtime import graph, which `.dependency-cruiser.cjs`'s `no-circular`
// rule forbids (type-only edges are exempt). MikroORM resolves "Owner" and
// "Tag" by entity name during metadata discovery, and `@kavo/mikroorm` reads
// the resolved class off `targetMeta` rather than calling the declaration —
// see doc 17 §1.
import type { Owner } from "../owner/owner.entity.js";
import type { Tag } from "../tag/tag.entity.js";

/** Enum column shared by every Pet subtype. */
export enum PetSizeEnum {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

/**
 * The single-table inheritance base. `Pet` is never served directly — you
 * cannot create a bare Pet, only a concrete Cat or Dog — so the class is
 * `abstract`. `discriminatorColumn` names the column MikroORM writes itself
 * from the subtype being persisted.
 *
 * Like the TypeORM example's base, that column has no entity property worth
 * speaking of: MikroORM never hydrates it and never serializes it, so it
 * cannot reach a response. The adapter still reports it *generated*, which
 * is what keeps it out of the writable projection — see doc 17 §1.
 */
@Entity({ abstract: true, discriminatorColumn: "species" })
export abstract class Pet {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  name!: string;

  @Property({ type: "number" })
  age!: number;

  // An enum column: the adapter surfaces it as the `enum` FieldKind with its
  // allowed values, so filters coerce against the set.
  @Enum({ items: () => PetSizeEnum })
  size: PetSizeEnum = PetSizeEnum.Medium;

  @ManyToOne((): any => "Owner", { nullable: true })
  owner: Owner | null = null;

  // Owning side of the many-to-many edge: `include=tags` loads through the
  // pivot table MikroORM creates. Unidirectional — `Tag` has no inverse
  // `pets` field, since nothing browses pets from a tag.
  @ManyToMany((): any => "Tag", undefined, { owner: true })
  tags = new Collection<Tag>(this);

  @Property({ type: "Date", onCreate: () => new Date() })
  createdAt!: Date;
}
