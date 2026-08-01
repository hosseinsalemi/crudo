import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

/**
 * A label shared across pets. Unidirectional: `Tag` carries no back-reference
 * to `Pet` because nothing in this app browses pets from a tag — the owning
 * `@ManyToMany` lives on `Pet` (ADR-0014's id-association path
 * exercised over a many-to-many edge for the first time in this app).
 */
@Entity()
export class Tag {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  name!: string;
}
