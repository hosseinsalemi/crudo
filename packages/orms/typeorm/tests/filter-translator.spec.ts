import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import type { ObjectLiteral } from "typeorm";
import type { Filter, FilterExpression } from "@kavo/core";
import { FilterTranslator } from "@kavo/typeorm";

/**
 * The mirror of `@kavo/mongoose`'s and `@kavo/mikroorm`'s translator specs:
 * every row of the operator table in
 * `docs/internals/architecture/05-query-grammar.md` §1, the logical
 * combinators, and relation-path handling — asserted on what actually
 * reaches the database.
 *
 * The other three adapters translate to a plain object, so their specs
 * assert one. This one mutates a `SelectQueryBuilder`, so the observable
 * output is the generated SQL plus its bound parameters; a real (in-memory
 * SQLite) `DataSource` supplies the builder rather than a fake, because the
 * identifier quoting and join clauses under test are the driver's work.
 */

@Entity()
class Author {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  name!: string;

  @OneToMany(() => Book, (book) => book.author)
  books!: Book[];
}

@Entity()
class Book {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  title!: string;

  @Column("int")
  pages!: number;

  @Column("varchar", { nullable: true })
  blurb!: string | null;

  @ManyToOne(() => Author, (author) => author.books)
  author!: Author;
}

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [Author, Book],
    synchronize: true,
  });
  await dataSource.initialize();
});

afterAll(async () => {
  await dataSource.destroy();
});

function condition(field: string, operator: string, value: unknown): FilterExpression {
  return { kind: "condition", field, operator, value } as FilterExpression;
}

function group(operator: "AND" | "OR" | "NOT", children: FilterExpression[]): FilterExpression {
  return { kind: "group", operator, children } as FilterExpression;
}

/** Translate `root` against a fresh builder and report the whole statement. */
function translate(
  root: FilterExpression | null,
  prepare: (translator: FilterTranslator<Book>, qb: ReturnType<typeof builderFor>) => void = () => {},
): { sql: string; parameters: ObjectLiteral } {
  const qb = builderFor();
  const translator = new FilterTranslator<Book>(qb, "root");
  prepare(translator, qb);
  translator.apply({ root } as Filter<Book>);
  return { sql: qb.getQuery(), parameters: qb.getParameters() };
}

function builderFor() {
  return dataSource.createQueryBuilder(Book, "root");
}

/** Just the predicate — the SELECT list is the driver's business, not ours. */
function whereOf(root: FilterExpression | null): string {
  const { sql } = translate(root);
  return sql.split(" WHERE ")[1] ?? "";
}

describe("FilterTranslator — comparison operators", () => {
  it.each([
    ["EQ", "title", "Dune", `("root"."title" = :p0)`, "Dune"],
    ["NE", "title", "Dune", `("root"."title" != :p0)`, "Dune"],
    ["GT", "pages", 100, `("root"."pages" > :p0)`, 100],
    ["GTE", "pages", 100, `("root"."pages" >= :p0)`, 100],
    ["LT", "pages", 100, `("root"."pages" < :p0)`, 100],
    ["LTE", "pages", 100, `("root"."pages" <= :p0)`, 100],
  ])("maps %s onto its SQL comparison with a bound parameter", (operator, field, value, sql, bound) => {
    const { parameters } = translate(condition(field, operator, value));
    expect(whereOf(condition(field, operator, value))).toBe(sql);
    expect(parameters["p0"]).toBe(bound);
  });

  it("maps IN and NOT_IN onto a spread parameter list", () => {
    const inSet = translate(condition("title", "IN", ["Dune", "Emma"]));
    expect(inSet.sql).toContain(`("root"."title" IN (:...p0))`);
    expect(inSet.parameters["p0"]).toEqual(["Dune", "Emma"]);

    const notIn = translate(condition("title", "NOT_IN", ["Dune"]));
    expect(notIn.sql).toContain(`("root"."title" NOT IN (:...p0))`);
    expect(notIn.parameters["p0"]).toEqual(["Dune"]);
  });

  it("maps BETWEEN onto two independently named bound parameters", () => {
    const { sql, parameters } = translate(condition("pages", "BETWEEN", [100, 200]));
    expect(sql).toContain(`("root"."pages" BETWEEN :p0_lo AND :p0_hi)`);
    expect(parameters).toMatchObject({ p0_lo: 100, p0_hi: 200 });
  });

  it("maps IS_NULL and IS_NOT_NULL onto SQL null tests with no parameter", () => {
    expect(whereOf(condition("blurb", "IS_NULL", true))).toBe(`("root"."blurb" IS NULL)`);
    expect(whereOf(condition("blurb", "IS_NOT_NULL", true))).toBe(`("root"."blurb" IS NOT NULL)`);
    expect(translate(condition("blurb", "IS_NULL", true)).parameters).toEqual({});
  });

  it("emits no WHERE clause at all for a filter with no root", () => {
    expect(translate(null).sql).not.toContain("WHERE");
  });
});

/**
 * `= NULL` is never true in SQL, so an `EQ null` that translated literally
 * would silently match nothing — and `!= NULL` would silently match nothing
 * where the caller asked for "anything but null".
 */
describe("FilterTranslator — null-valued equality", () => {
  it("rewrites EQ null and NE null as null tests", () => {
    expect(whereOf(condition("blurb", "EQ", null))).toBe(`("root"."blurb" IS NULL)`);
    expect(whereOf(condition("blurb", "NE", null))).toBe(`("root"."blurb" IS NOT NULL)`);
  });
});

/**
 * SQL has no `IN ()`: emitting one is a syntax error, so the empty set is
 * spelled as the constant it means. `NOT IN ()` is the tautology, which is
 * the case a naive "skip the predicate" would get right by accident and
 * `IN ()` would get catastrophically wrong.
 */
describe("FilterTranslator — the empty value set", () => {
  it("spells an empty IN as a contradiction and an empty NOT_IN as a tautology", () => {
    expect(whereOf(condition("title", "IN", []))).toBe("(1 = 0)");
    expect(whereOf(condition("title", "NOT_IN", []))).toBe("(1 = 1)");
  });
});

describe("FilterTranslator — LIKE and ILIKE", () => {
  it("binds the backslash escape character as a parameter, never as a literal", () => {
    // Drivers disagree about backslash inside a string literal (MySQL's
    // default sql_mode treats it as an escape character, Postgres does not),
    // so `ESCAPE '\'` is not portable — a bound parameter is.
    const { sql, parameters } = translate(condition("title", "LIKE", "100\\%"));
    expect(sql).toContain(`("root"."title" LIKE :p0 ESCAPE :p0Escape)`);
    expect(parameters).toEqual({ p0: "100\\%", p0Escape: "\\" });
  });

  it("translates ILIKE portably as LOWER() LIKE LOWER(), with the same escape", () => {
    const { sql, parameters } = translate(condition("title", "ILIKE", "a%"));
    expect(sql).toContain(`(LOWER("root"."title") LIKE LOWER(:p0) ESCAPE :p0Escape)`);
    expect(parameters).toEqual({ p0: "a%", p0Escape: "\\" });
  });

  it("passes the caller's pattern through unaltered — no wildcards are added", () => {
    expect(translate(condition("title", "LIKE", "john")).parameters["p0"]).toBe("john");
  });
});

describe("FilterTranslator — logical groups", () => {
  const left = condition("title", "EQ", "Dune");
  const right = condition("pages", "GT", 100);

  it("joins AND and OR children with explicit parentheses", () => {
    expect(whereOf(group("AND", [left, right]))).toBe(`(("root"."title" = :p0) AND ("root"."pages" > :p1))`);
    expect(whereOf(group("OR", [left, right]))).toBe(`(("root"."title" = :p0) OR ("root"."pages" > :p1))`);
  });

  it("wraps a NOT group in SQL NOT over its single child", () => {
    expect(whereOf(group("NOT", [left]))).toBe(`NOT(("root"."title" = :p0))`);
  });

  it("keeps precedence when an OR nests inside an AND", () => {
    // Parentheses, not operator-order luck: without the inner brackets this
    // would read as `a AND b OR c` and match rows the caller excluded.
    const nested = group("AND", [left, group("OR", [right, condition("pages", "LT", 10)])]);
    expect(whereOf(nested)).toBe(`(("root"."title" = :p0) AND (("root"."pages" > :p1) OR ("root"."pages" < :p2)))`);
  });

  it("numbers parameters globally, so repeated conditions on one field cannot collide", () => {
    const { parameters } = translate(group("AND", [condition("pages", "GTE", 100), condition("pages", "LT", 200)]));
    expect(parameters).toEqual({ p0: 100, p1: 200 });
  });

  it("refuses an operator outside the AST enum rather than dropping the predicate", () => {
    // A dropped predicate widens the result set silently, which is the one
    // failure mode a filter must never have.
    expect(() => whereOf(condition("title", "SOUNDS_LIKE", "x"))).toThrowError(/filter operator/);
  });
});

describe("FilterTranslator — relation paths", () => {
  it("adds one non-selecting left join per segment, under a deterministic alias", () => {
    const { sql } = translate(condition("author.name", "EQ", "Ada"));
    expect(sql).toContain(`LEFT JOIN "author" "root__author"`);
    expect(sql).toContain(`("root__author"."name" = :p0)`);
    // Non-selecting: the join restricts root rows, it never loads the
    // relation — that is what `include=` is for.
    expect(sql).not.toContain(`"root__author"."name" AS`);
  });

  it("chains a join per segment of a multi-segment path", () => {
    // TypeORM nests the second join inside the first, so the aliases — not
    // the clause order — are what identifies the chain.
    const { sql } = translate(condition("author.books.title", "EQ", "Dune"));
    expect(sql.match(/LEFT JOIN/g)).toHaveLength(2);
    expect(sql).toContain(`"author" "root__author"`);
    expect(sql).toContain(`LEFT JOIN "book" "root__author__books"`);
    expect(sql).toContain(`("root__author__books"."title" = :p0)`);
  });

  it("reuses one join for repeated references to the same path", () => {
    const { sql } = translate(group("AND", [condition("author.name", "EQ", "Ada"), condition("author.id", "GT", 1)]));
    expect(sql.match(/LEFT JOIN/g)).toHaveLength(1);
    expect(sql).toContain(`("root__author"."name" = :p0)`);
    expect(sql).toContain(`("root__author"."id" > :p1)`);
  });

  it("reuses a join someone else registered rather than duplicating it", () => {
    // An include join selects its relation; a filter join only restricts. If
    // both were added under the same alias the query would be invalid, and
    // if the filter's non-selecting join won, the include would come back
    // empty.
    const { sql } = translate(condition("author.name", "EQ", "Ada"), (translator, qb) => {
      qb.leftJoinAndSelect("root.author", "root__author");
      translator.registerJoin("root__author");
    });
    expect(sql.match(/LEFT JOIN/g)).toHaveLength(1);
    expect(sql).toContain(`"root__author"."name" AS "root__author_name"`);
    expect(sql).toContain(`("root__author"."name" = :p0)`);
  });

  it("leaves an undotted field on the root alias", () => {
    const { sql } = translate(condition("title", "EQ", "Dune"));
    expect(sql).not.toContain("LEFT JOIN");
    expect(sql).toContain(`("root"."title" = :p0)`);
  });
});
