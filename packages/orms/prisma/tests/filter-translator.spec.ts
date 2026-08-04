import { describe, expect, it } from "vitest";
import type { Filter, FilterExpression } from "@kavo/core";
import { translateFilter } from "@kavo/prisma";

/** The connector setting only reaches `ILIKE`; everything else is invariant. */
const options = { caseInsensitiveFilters: false };
const insensitive = { caseInsensitiveFilters: true };

function condition(field: string, operator: string, value: unknown): FilterExpression {
  return { kind: "condition", field, operator, value } as FilterExpression;
}

function group(operator: "AND" | "OR" | "NOT", children: FilterExpression[]): FilterExpression {
  return { kind: "group", operator, children } as FilterExpression;
}

function translate(root: FilterExpression | null, opts = options): unknown {
  return translateFilter({ root } as Filter, opts);
}

function ilikeFilter(value: string): Filter {
  return { root: { kind: "condition", field: "name", operator: "ILIKE", value } };
}

describe("translateFilter — shape", () => {
  it("returns undefined for an empty filter, so no `where` is sent at all", () => {
    expect(translate(null)).toBeUndefined();
  });
});

describe("translateFilter — operators", () => {
  it.each([
    ["EQ", "Ada", { name: { equals: "Ada" } }],
    ["NE", "Ada", { name: { not: "Ada" } }],
    ["GT", 30, { name: { gt: 30 } }],
    ["GTE", 30, { name: { gte: 30 } }],
    ["LT", 30, { name: { lt: 30 } }],
    ["LTE", 30, { name: { lte: 30 } }],
    ["IN", ["a", "b"], { name: { in: ["a", "b"] } }],
    ["NOT_IN", ["a", "b"], { name: { notIn: ["a", "b"] } }],
    ["BETWEEN", [1, 9], { name: { gte: 1, lte: 9 } }],
    ["IS_NULL", true, { name: { equals: null } }],
    ["IS_NOT_NULL", true, { name: { not: null } }],
  ])("maps %s onto its Prisma filter", (operator, value, expected) => {
    expect(translate(condition("name", operator, value))).toEqual(expected);
  });

  it("throws rather than dropping an operator outside the AST enum", () => {
    // Prisma ignores unknown keys in a `where`, so a dropped predicate would
    // silently widen the result set instead of erroring.
    expect(() => translate(condition("name", "SOUNDS_LIKE", "x"))).toThrowError(/filter operator/);
  });
});

/**
 * Prisma has no raw pattern operator — only
 * `contains`/`startsWith`/`endsWith`/`equals` — so the wildcard *position*
 * in the caller's SQL pattern decides which one is emitted. Collapsing
 * everything to `contains` would turn `A%` ("starts with A") into "has an A
 * somewhere", which is a wider result set than the caller asked for.
 */
describe("translateFilter — LIKE wildcard positions", () => {
  it.each([
    ["%john%", { contains: "john" }],
    ["A%", { startsWith: "A" }],
    ["%son", { endsWith: "son" }],
    ["john", { equals: "john" }],
  ])("reads the pattern %s by where its wildcards sit", (pattern, expected) => {
    expect(translate(condition("name", "LIKE", pattern))).toEqual({ name: expected });
  });
});

describe("translateFilter — caseInsensitiveFilters", () => {
  it("adds Prisma's mode: 'insensitive' for ILIKE when the connector supports it (default)", () => {
    const where = translateFilter(ilikeFilter("a%"), { caseInsensitiveFilters: true });
    expect(where).toEqual({ name: { startsWith: "a", mode: "insensitive" } });
  });

  it("omits mode entirely when the connector doesn't support it (e.g. SQLite)", () => {
    const where = translateFilter(ilikeFilter("a%"), { caseInsensitiveFilters: false });
    expect(where).toEqual({ name: { startsWith: "a" } });
  });

  it("leaves plain LIKE untouched by the setting either way", () => {
    const filter: Filter = { root: { kind: "condition", field: "name", operator: "LIKE", value: "a%" } };
    expect(translateFilter(filter, { caseInsensitiveFilters: true })).toEqual({ name: { startsWith: "a" } });
    expect(translateFilter(filter, { caseInsensitiveFilters: false })).toEqual({ name: { startsWith: "a" } });
  });

  it("carries the mode onto every ILIKE wildcard position, not just the prefix one", () => {
    expect(translate(condition("name", "ILIKE", "%a%"), insensitive)).toEqual({
      name: { contains: "a", mode: "insensitive" },
    });
    expect(translate(condition("name", "ILIKE", "a"), insensitive)).toEqual({
      name: { equals: "a", mode: "insensitive" },
    });
  });
});

describe("translateFilter — logical groups", () => {
  const left = condition("name", "EQ", "Ada");
  const right = condition("age", "GT", 30);

  it("maps AND and OR onto Prisma's own combinators", () => {
    expect(translate(group("AND", [left, right]))).toEqual({
      AND: [{ name: { equals: "Ada" } }, { age: { gt: 30 } }],
    });
    expect(translate(group("OR", [left, right]))).toEqual({
      OR: [{ name: { equals: "Ada" } }, { age: { gt: 30 } }],
    });
  });

  it("maps a NOT group onto NOT over its single child", () => {
    expect(translate(group("NOT", [left]))).toEqual({ NOT: { name: { equals: "Ada" } } });
  });

  it("nests groups without losing precedence", () => {
    const nested = group("AND", [left, group("OR", [right, condition("age", "LT", 10)])]);
    expect(translate(nested)).toEqual({
      AND: [{ name: { equals: "Ada" } }, { OR: [{ age: { gt: 30 } }, { age: { lt: 10 } }] }],
    });
  });
});

/**
 * Prisma's `where` nests relation paths natively, so unlike `@kavo/typeorm`
 * this translator adds no join — a dotted field simply nests the same leaf
 * one level deeper.
 */
describe("translateFilter — relation paths", () => {
  it("nests a dotted path into Prisma's relation shape", () => {
    expect(translate(condition("author.name", "EQ", "Ada"))).toEqual({
      author: { name: { equals: "Ada" } },
    });
  });

  it("nests a multi-segment path all the way down", () => {
    expect(translate(condition("author.city.name", "EQ", "Paris"))).toEqual({
      author: { city: { name: { equals: "Paris" } } },
    });
  });

  it("nests every operator's leaf, not just equality", () => {
    expect(translate(condition("author.age", "GTE", 18))).toEqual({ author: { age: { gte: 18 } } });
    expect(translate(condition("author.name", "IN", ["Ada", "Grace"]))).toEqual({
      author: { name: { in: ["Ada", "Grace"] } },
    });
    expect(translate(condition("author.name", "ILIKE", "a%"), insensitive)).toEqual({
      author: { name: { startsWith: "a", mode: "insensitive" } },
    });
  });

  it("leaves an undotted field at the top level", () => {
    expect(translate(condition("author", "EQ", "abc"))).toEqual({ author: { equals: "abc" } });
  });

  it("nests a relation path the same way inside a logical group", () => {
    expect(translate(group("OR", [condition("author.name", "EQ", "Ada"), condition("title", "EQ", "x")]))).toEqual({
      OR: [{ author: { name: { equals: "Ada" } } }, { title: { equals: "x" } }],
    });
  });
});
