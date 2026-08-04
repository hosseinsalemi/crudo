import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

/**
 * A label shared across pets. Unidirectional: `Tag` carries no
 * back-reference to `Pet` because nothing in this app browses pets from a
 * tag — the owning `@ManyToMany` lives on `Pet` (ADR-0014's id-association
 * path, over a many-to-many edge).
 */
@Entity()
export class Tag {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  name!: string;
}
