import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * The Milestone B checkpoint entity. Explicit column types keep the
 * entity independent of `emitDecoratorMetadata` transforms.
 */
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar", { unique: true })
  email!: string;

  @Column("varchar")
  name!: string;

  @Column("int")
  age!: number;

  @Column("varchar", { default: "pending" })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
