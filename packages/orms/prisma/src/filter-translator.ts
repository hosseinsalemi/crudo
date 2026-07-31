import type { Filter, FilterCondition, FilterExpression, FilterScalar } from "@kavo/core";
import { assertNever } from "@kavo/core";

/** A Prisma `where` input, built structurally — no generated type is required to build one. */
export type PrismaWhere = Record<string, unknown>;

/**
 * Whether the target connector supports Prisma's `mode: "insensitive"`
 * string filter — Postgres and MongoDB do; MySQL, SQLite, and SQL Server
 * reject the argument outright. There is no reliable way to detect this
 * from the DMMF at runtime, so it is an explicit, caller-declared setting
 * (see `PrismaInfrastructureOptions.caseInsensitiveFilters`) rather than a
 * guess. On an unsupported connector, `ILIKE` degrades to the same
 * translation as `LIKE` — on SQLite in particular this is not a loss of
 * behavior, since SQLite's own `LIKE` is already ASCII case-insensitive.
 */
export interface FilterTranslatorOptions {
  readonly caseInsensitiveFilters: boolean;
}

/**
 * Filter AST → Prisma `where` object.
 *
 * Unlike `@kavo/typeorm`'s translator, this needs no query-builder state
 * (no join aliases, no parameter numbering): Prisma's `where` already
 * nests relation paths natively (`{ author: { name: { equals: "Ada" } } }`),
 * so a relation-path field (`author.name`) simply nests the same
 * translation one level deeper instead of adding a join.
 */
export function translateFilter<Entity>(
  filter: Filter<Entity>,
  options: FilterTranslatorOptions,
): PrismaWhere | undefined {
  const root = filter.root;
  if (root === null) return undefined;
  return translateExpression(root, options);
}

function translateExpression(expression: FilterExpression, options: FilterTranslatorOptions): PrismaWhere {
  if (expression.kind === "condition") {
    return translateCondition(expression, options);
  }
  if (expression.operator === "NOT") {
    const child = expression.children[0];
    return { NOT: child === undefined ? {} : translateExpression(child, options) };
  }
  const key = expression.operator === "OR" ? "OR" : "AND";
  return { [key]: expression.children.map((child) => translateExpression(child, options)) };
}

/** Nest `condition.field` (`"author.name"`) into Prisma's native relation-path shape. */
function nest(field: string, leaf: Record<string, unknown>): PrismaWhere {
  const segments = field.split(".");
  return segments.reduceRight<Record<string, unknown>>((inner, segment) => ({ [segment]: inner }), leaf);
}

function translateCondition(condition: FilterCondition, options: FilterTranslatorOptions): PrismaWhere {
  const field = condition.field as string;
  const value = condition.value;

  switch (condition.operator) {
    case "EQ":
      return nest(field, { equals: value as FilterScalar });
    case "NE":
      return nest(field, { not: value as FilterScalar });
    case "GT":
      return nest(field, { gt: value });
    case "GTE":
      return nest(field, { gte: value });
    case "LT":
      return nest(field, { lt: value });
    case "LTE":
      return nest(field, { lte: value });
    case "IN":
      return nest(field, { in: value as readonly FilterScalar[] });
    case "NOT_IN":
      return nest(field, { notIn: value as readonly FilterScalar[] });
    case "LIKE":
      return nest(field, likeToPrismaStringFilter(value as string));
    case "ILIKE":
      return nest(field, {
        ...likeToPrismaStringFilter(value as string),
        ...(options.caseInsensitiveFilters && { mode: "insensitive" }),
      });
    case "BETWEEN": {
      const [low, high] = value as readonly FilterScalar[];
      return nest(field, { gte: low, lte: high });
    }
    case "IS_NULL":
      return nest(field, { equals: null });
    case "IS_NOT_NULL":
      return nest(field, { not: null });
    default:
      // Every AST operator must translate to a predicate — proven total
      // here at build time, same guarantee as `@kavo/typeorm`'s translator.
      return assertNever(condition.operator, "filter operator");
  }
}

/**
 * `LIKE`/`ILIKE` carry SQL wildcard syntax (`%prefix%`, `A%`, `%suffix`)
 * from the parser; Prisma has no raw pattern operator, only
 * `contains`/`startsWith`/`endsWith`/`equals`. The wildcard *position*
 * decides which one — `A%` is a prefix match (`startsWith`), not "contains
 * A somewhere", so the two ends are checked independently rather than
 * always falling back to `contains`.
 */
function likeToPrismaStringFilter(pattern: string): Record<string, unknown> {
  const leading = pattern.startsWith("%");
  const trailing = pattern.endsWith("%") && pattern.length > 1;
  const stripped = pattern.slice(leading ? 1 : 0, trailing ? -1 : undefined);
  if (leading && trailing) return { contains: stripped };
  if (trailing) return { startsWith: stripped };
  if (leading) return { endsWith: stripped };
  return { equals: stripped };
}
