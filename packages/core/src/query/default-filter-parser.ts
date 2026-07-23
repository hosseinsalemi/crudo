import type {
  Filter,
  FilterCondition,
  FilterExpression,
  FilterOperator,
  FilterScalar,
} from "./filter.js";
import type { FilterParser } from "./filter-parser.js";
import type { FieldPath } from "../types/field-path.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { EntityMetadata, FieldMetadata } from "../metadata/entity-metadata.js";
import type { QueryIssueDto } from "../errors/problem-details.js";
import { QueryValidationException } from "../errors/exceptions.js";
import { coerceScalar, isIssue } from "./value-coercion.js";
import { parseBracketKey } from "./bracket-notation.js";

/**
 * Wire token → AST operator (the Phase 5 single-source-of-truth table).
 * Tokens are camelCase and exact-case matched — one spelling, no aliases.
 */
const WIRE_OPERATORS: Readonly<Record<string, FilterOperator>> = {
  eq: "EQ",
  ne: "NE",
  gt: "GT",
  gte: "GTE",
  lt: "LT",
  lte: "LTE",
  in: "IN",
  notIn: "NOT_IN",
  like: "LIKE",
  ilike: "ILIKE",
  between: "BETWEEN",
  isNull: "IS_NULL",
  isNotNull: "IS_NOT_NULL",
};

const LOGICAL_TOKENS = new Set(["and", "or", "not"]);

/**
 * Parses the Phase 5 filter grammar — bracket notation
 * (`filter[age][gte]=18`, `filter[or][0][role][eq]=admin`) and the
 * JSON escape hatch (`filter={"or":[…]}`) — into the filter AST. Both
 * forms produce the identical AST; when both appear they AND together.
 *
 * Parsing is where the security posture lives: filterable-allowlist
 * checks, metadata-driven value coercion, tree-depth and array-length
 * limits. Every violation becomes a field-level issue on one
 * `QueryValidationException` (a 400 listing *all* problems), never a
 * silent drop.
 */
export class DefaultFilterParser<Entity = unknown>
  implements FilterParser<Entity>
{
  private readonly fields: ReadonlyMap<string, FieldMetadata>;

  constructor(metadata: EntityMetadata<Entity>) {
    this.fields = new Map(metadata.fields.map((field) => [field.name, field]));
  }

  parse(
    rawParams: Readonly<Record<string, unknown>>,
    config: ResolvedEntityConfig<Entity>,
  ): Filter<Entity> {
    const issues: QueryIssueDto[] = [];
    const roots: FilterExpression<Entity>[] = [];

    const bracketTree = this.collectBracketTree(rawParams);
    if (bracketTree !== null) {
      const expression = this.convertNode(bracketTree, config, issues);
      if (expression !== null) roots.push(expression);
    }

    const json = rawParams["filter"];
    if (typeof json === "string") {
      const parsed = this.parseJsonFilter(json, issues);
      if (parsed !== null) {
        const expression = this.convertNode(parsed, config, issues);
        if (expression !== null) roots.push(expression);
      }
    }

    const root =
      roots.length === 0
        ? null
        : roots.length === 1
          ? (roots[0] as FilterExpression<Entity>)
          : ({ kind: "group", operator: "AND", children: roots } as const);

    if (root !== null) {
      const depth = expressionDepth(root);
      const maxDepth = config.settings.query.maxFilterDepth;
      if (depth > maxDepth) {
        issues.push({
          field: "filter",
          code: "CRUDO_QUERY_LIMIT_EXCEEDED",
          detail: `Filter depth ${depth} exceeds the configured maximum of ${maxDepth}.`,
        });
      }
    }

    if (issues.length > 0) {
      throw new QueryValidationException(issues, {
        context: { entityName: config.entityName },
      });
    }
    return { root };
  }

  /** Fold every `filter[...]` param into one nested node tree. */
  private collectBracketTree(
    rawParams: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | null {
    const tree: Record<string, unknown> = {};
    let found = false;
    for (const [key, value] of Object.entries(rawParams)) {
      const segments = parseBracketKey(key, "filter");
      if (segments === null) continue;
      found = true;
      assignPath(tree, segments, value);
    }
    return found ? tree : null;
  }

  private parseJsonFilter(
    json: string,
    issues: QueryIssueDto[],
  ): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(json);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      issues.push({
        field: "filter",
        code: "CRUDO_QUERY_INVALID_VALUE",
        detail: "JSON filter must be an object.",
      });
    } catch {
      issues.push({
        field: "filter",
        code: "CRUDO_QUERY_INVALID_VALUE",
        detail: "filter is not valid JSON.",
      });
    }
    return null;
  }

  /**
   * One node = one implicit-AND object: field entries and/or logical
   * groups. Returns `null` when the node contributed nothing (empty, or
   * all entries were invalid — the issues carry the story).
   */
  private convertNode(
    node: Record<string, unknown>,
    config: ResolvedEntityConfig<Entity>,
    issues: QueryIssueDto[],
  ): FilterExpression<Entity> | null {
    const children: FilterExpression<Entity>[] = [];

    for (const [key, value] of Object.entries(node)) {
      if (LOGICAL_TOKENS.has(key)) {
        this.convertLogical(key, value, config, issues, children);
        continue;
      }
      this.convertConditions(key, value, config, issues, children);
    }

    if (children.length === 0) return null;
    if (children.length === 1) return children[0] as FilterExpression<Entity>;
    return { kind: "group", operator: "AND", children };
  }

  private convertLogical(
    token: string,
    value: unknown,
    config: ResolvedEntityConfig<Entity>,
    issues: QueryIssueDto[],
    out: FilterExpression<Entity>[],
  ): void {
    if (typeof value !== "object" || value === null) {
      issues.push({
        field: `filter[${token}]`,
        code: "CRUDO_QUERY_INVALID_VALUE",
        detail: `'${token}' must carry nested filter groups.`,
      });
      return;
    }
    if (token === "not") {
      const child = this.convertNode(
        value as Record<string, unknown>,
        config,
        issues,
      );
      if (child !== null) {
        out.push({ kind: "group", operator: "NOT", children: [child] });
      }
      return;
    }
    // `or` / `and`: an array (JSON) or an object with index keys (bracket).
    const branches = Array.isArray(value) ? value : Object.values(value);
    const children: FilterExpression<Entity>[] = [];
    for (const branch of branches) {
      if (typeof branch !== "object" || branch === null) {
        issues.push({
          field: `filter[${token}]`,
          code: "CRUDO_QUERY_INVALID_VALUE",
          detail: `Each '${token}' branch must be a filter group.`,
        });
        continue;
      }
      const child = this.convertNode(
        branch as Record<string, unknown>,
        config,
        issues,
      );
      if (child !== null) children.push(child);
    }
    if (children.length > 0) {
      out.push({
        kind: "group",
        operator: token === "or" ? "OR" : "AND",
        children,
      });
    }
  }

  private convertConditions(
    field: string,
    value: unknown,
    config: ResolvedEntityConfig<Entity>,
    issues: QueryIssueDto[],
    out: FilterExpression<Entity>[],
  ): void {
    if (
      !(config.allowlists.filterable as readonly string[]).includes(field)
    ) {
      issues.push({
        field,
        code: "CRUDO_QUERY_INVALID_FIELD",
        detail: `Field '${field}' cannot be used for filtering.`,
      });
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({
        field,
        code: "CRUDO_QUERY_INVALID_OPERATOR",
        detail: `filter[${field}] must use the filter[${field}][operator]=value form.`,
      });
      return;
    }
    for (const [token, raw] of Object.entries(value)) {
      const condition = this.buildCondition(field, token, raw, config, issues);
      if (condition !== null) out.push(condition);
    }
  }

  private buildCondition(
    field: string,
    token: string,
    raw: unknown,
    config: ResolvedEntityConfig<Entity>,
    issues: QueryIssueDto[],
  ): FilterCondition<Entity> | null {
    const operator = WIRE_OPERATORS[token];
    if (operator === undefined) {
      issues.push({
        field,
        code: "CRUDO_QUERY_INVALID_OPERATOR",
        detail: `Unknown filter operator '${token}' on field '${field}'.`,
      });
      return null;
    }
    const metadata = this.fields.get(field);
    const path = field as FieldPath<Entity>;

    switch (operator) {
      case "IS_NULL":
      case "IS_NOT_NULL": {
        // Boolean-valued: `isNull=false` flips to the complementary
        // operator, so both spellings mean what they read as.
        const flag = String(raw);
        if (flag !== "true" && flag !== "false") {
          issues.push({
            field,
            code: "CRUDO_QUERY_INVALID_VALUE",
            detail: `'${token}' takes true or false, got '${flag}'.`,
          });
          return null;
        }
        const flip = flag === "false";
        const effective =
          (operator === "IS_NULL") !== flip ? "IS_NULL" : "IS_NOT_NULL";
        return { kind: "condition", field: path, operator: effective, value: true };
      }
      case "IN":
      case "NOT_IN": {
        const parts = splitMultiValue(raw);
        const max = config.settings.query.maxInValues;
        if (parts.length > max) {
          issues.push({
            field,
            code: "CRUDO_QUERY_LIMIT_EXCEEDED",
            detail: `'${token}' carries ${parts.length} values; the maximum is ${max}.`,
          });
          return null;
        }
        const values = this.coerceAll(parts, field, metadata, issues);
        if (values === null) return null;
        return { kind: "condition", field: path, operator, value: values };
      }
      case "BETWEEN": {
        const parts = splitMultiValue(raw);
        if (parts.length !== 2) {
          issues.push({
            field,
            code: "CRUDO_QUERY_INVALID_VALUE",
            detail: `'between' takes exactly two comma-separated bounds, got ${parts.length}.`,
          });
          return null;
        }
        const values = this.coerceAll(parts, field, metadata, issues);
        if (values === null) return null;
        return { kind: "condition", field: path, operator, value: values };
      }
      case "LIKE":
      case "ILIKE": {
        if (metadata !== undefined && metadata.kind !== "string") {
          issues.push({
            field,
            code: "CRUDO_QUERY_INVALID_VALUE",
            detail: `'${token}' applies to string columns; '${field}' is ${metadata.kind}.`,
          });
          return null;
        }
        // No auto-wrapped wildcards: callers pass `%` explicitly; literal
        // `%`/`_` are escaped with a backslash (`\%`) — the adapter emits
        // the matching ESCAPE clause.
        return {
          kind: "condition",
          field: path,
          operator,
          value: String(raw),
        };
      }
      default: {
        const value = coerceScalar(raw, field, metadata);
        if (isIssue(value)) {
          issues.push(value);
          return null;
        }
        return { kind: "condition", field: path, operator, value };
      }
    }
  }

  private coerceAll(
    parts: readonly unknown[],
    field: string,
    metadata: FieldMetadata | undefined,
    issues: QueryIssueDto[],
  ): readonly FilterScalar[] | null {
    const values: FilterScalar[] = [];
    let failed = false;
    for (const part of parts) {
      const value = coerceScalar(part, field, metadata);
      if (isIssue(value)) {
        issues.push(value);
        failed = true;
      } else {
        values.push(value);
      }
    }
    return failed ? null : values;
  }
}

/** Comma-separated by default; the repeated-key form arrives as an array. */
function splitMultiValue(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return raw.split(",");
  return [raw];
}

function expressionDepth(expression: FilterExpression<unknown>): number {
  if (expression.kind === "condition") return 1;
  let deepest = 0;
  for (const child of expression.children) {
    const depth = expressionDepth(child);
    if (depth > deepest) deepest = depth;
  }
  return 1 + deepest;
}

/**
 * Set `value` at `segments` in a nested record. A trailing empty segment
 * (the repeated-key form `filter[status][in][]=a&filter[status][in][]=b`)
 * appends into an array at the parent key instead.
 */
function assignPath(
  tree: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  const append = segments[segments.length - 1] === "";
  const path = append ? segments.slice(0, -1) : segments;
  if (path.length === 0) return;

  let node = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i] as string;
    const existing = node[segment];
    if (
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      node = existing as Record<string, unknown>;
    } else {
      const next: Record<string, unknown> = {};
      node[segment] = next;
      node = next;
    }
  }
  const last = path[path.length - 1] as string;
  if (append) {
    const existing = node[last];
    const bucket = Array.isArray(existing)
      ? (existing as unknown[])
      : (node[last] = existing === undefined ? [] : [existing]) as unknown[];
    if (Array.isArray(value)) bucket.push(...(value as unknown[]));
    else bucket.push(value);
    return;
  }
  node[last] = value;
}
