import type { FieldSelection } from "./field-selection.js";
import type { Filter, FilterExpression } from "./filter.js";
import type { NormalizedQueryContext, QueryContext } from "./query-context.js";
import type { PaginationStrategy } from "./pagination.js";
import type { Sort } from "./sort.js";
import type { FieldPath } from "../types/field-path.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import type { QueryIssueDto } from "../errors/problem-details.js";
import {
  ConfigurationException,
  QueryValidationException,
} from "../errors/exceptions.js";
import { DefaultFilterParser } from "./default-filter-parser.js";
import { builtInPaginationStrategies } from "./pagination-strategies.js";
import { parseBracketKey } from "./bracket-notation.js";

/**
 * The Phase 5 normalization pipeline: raw query string → validated →
 * `NormalizedQueryContext`. Both entry points — wire params from the
 * framework layer and programmatic `QueryContext` input — funnel into the
 * same normalized shape, so the engine and adapters only ever see one
 * canonical, validated form.
 *
 * All issues from all sections (filter, sort, fields, pagination,
 * unsupported params) are collected into a single
 * `QueryValidationException`, so a client fixes its request in one round
 * trip.
 */
export class QueryNormalizer<Entity = unknown> {
  private readonly filterParser: DefaultFilterParser<Entity>;
  private readonly strategies: ReadonlyMap<string, PaginationStrategy>;

  constructor(
    metadata: EntityMetadata<Entity>,
    extraStrategies: readonly PaginationStrategy[] = [],
  ) {
    this.filterParser = new DefaultFilterParser(metadata);
    const strategies = new Map(builtInPaginationStrategies());
    for (const strategy of extraStrategies) {
      strategies.set(strategy.name, strategy);
    }
    this.strategies = strategies;
  }

  /** Normalize flat wire params (`filter[age][gte]=18&sort=-name&…`). */
  normalizeWire(
    rawParams: Readonly<Record<string, unknown>>,
    config: ResolvedEntityConfig<Entity>,
  ): NormalizedQueryContext<Entity> {
    const issues: QueryIssueDto[] = [];

    rejectUnsupported(rawParams, issues);

    let filter: Filter<Entity> = { root: null };
    try {
      filter = this.filterParser.parse(rawParams, config);
    } catch (error) {
      collectIssues(error, issues);
    }

    const sort = parseSort(rawParams["sort"], config, issues);
    const fields = parseFields(rawParams, config, issues);

    let pagination = { limit: 0, offset: 0 };
    try {
      pagination = this.strategyFor(config).normalize(rawParams, {
        defaultLimit: config.settings.pagination.defaultLimit,
        maxLimit: config.settings.pagination.maxLimit,
      });
    } catch (error) {
      collectIssues(error, issues);
    }

    if (issues.length > 0) {
      throw new QueryValidationException(issues, {
        context: { entityName: config.entityName },
      });
    }
    return {
      filter,
      sort,
      pagination,
      fields,
      include: {},
      withDeleted: false,
      count: config.settings.pagination.count,
    };
  }

  /**
   * Normalize programmatic input (`userCrud.findMany({ … })`). Values are
   * already typed — no coercion — but allowlists and limits are enforced
   * identically: the security posture cannot be bypassed by calling the
   * service directly with strings that defeat `FieldPath` typing.
   */
  normalizeInput(
    query: QueryContext<Entity> | undefined,
    config: ResolvedEntityConfig<Entity>,
  ): NormalizedQueryContext<Entity> {
    const issues: QueryIssueDto[] = [];
    const input = query ?? {};

    if (input.include !== undefined && input.include.length > 0) {
      issues.push(unsupportedIssue("include"));
    }
    if (input.withDeleted === true) {
      issues.push(unsupportedIssue("withDeleted"));
    }

    const root = input.filter ?? null;
    if (root !== null) {
      validateExpression(root, config, issues);
    }

    const sort = input.sort ?? [];
    for (const entry of sort) {
      requireAllowlisted(
        entry.field as string,
        config.allowlists.sortable,
        "sorting",
        issues,
      );
    }

    const rootFields = input.fields?.root ?? null;
    if (rootFields != null) {
      for (const field of rootFields) {
        requireAllowlisted(
          field as string,
          config.allowlists.selectable,
          "selection",
          issues,
        );
      }
    }
    if (
      input.fields?.relations !== undefined &&
      Object.keys(input.fields.relations).length > 0
    ) {
      issues.push(unsupportedIssue("fields[relation]"));
    }

    const { defaultLimit, maxLimit } = config.settings.pagination;
    const limit = Math.min(input.limit ?? defaultLimit, maxLimit);
    const offset = input.offset ?? 0;
    if (limit < 1 || offset < 0 || !Number.isInteger(limit) || !Number.isInteger(offset)) {
      issues.push({
        field: limit < 1 || !Number.isInteger(limit) ? "limit" : "offset",
        code: "CRUDO_QUERY_INVALID_VALUE",
        detail: `Pagination values must be integers (limit ≥ 1, offset ≥ 0).`,
      });
    }

    if (issues.length > 0) {
      throw new QueryValidationException(issues, {
        context: { entityName: config.entityName },
      });
    }
    return {
      filter: { root },
      sort,
      pagination: { limit, offset },
      fields: { root: rootFields, relations: {} },
      include: {},
      withDeleted: false,
      count: config.settings.pagination.count,
    };
  }

  private strategyFor(
    config: ResolvedEntityConfig<Entity>,
  ): PaginationStrategy {
    const name = config.settings.pagination.strategy;
    const strategy = this.strategies.get(name);
    if (strategy === undefined) {
      throw new ConfigurationException(
        config.entityName,
        "pagination.strategy",
        `unknown strategy '${name}' (available: ${[...this.strategies.keys()].join(", ")})`,
      );
    }
    return strategy;
  }
}

/**
 * The skeleton parses and rejects what it does not implement yet —
 * explicitly, never silently (Phase 5): `include` waits on Phase 16,
 * `withDeleted=true` on Phase 15.
 */
function rejectUnsupported(
  rawParams: Readonly<Record<string, unknown>>,
  issues: QueryIssueDto[],
): void {
  if (rawParams["include"] !== undefined) {
    issues.push(unsupportedIssue("include"));
  }
  const withDeleted = rawParams["withDeleted"];
  if (withDeleted !== undefined && String(withDeleted) !== "false") {
    issues.push(unsupportedIssue("withDeleted"));
  }
}

function unsupportedIssue(param: string): QueryIssueDto {
  const reason =
    param === "withDeleted"
      ? "soft delete ships in a later release (Phase 15)."
      : "relation includes ship in a later release (Phase 16).";
  return {
    field: param,
    code: "CRUDO_QUERY_UNSUPPORTED_PARAM",
    detail: `Query parameter '${param}' is not supported yet: ${reason}`,
  };
}

function parseSort<Entity>(
  raw: unknown,
  config: ResolvedEntityConfig<Entity>,
  issues: QueryIssueDto[],
): readonly Sort<Entity>[] {
  if (raw === undefined || raw === null || raw === "") return [];
  if (typeof raw !== "string") {
    issues.push({
      field: "sort",
      code: "CRUDO_QUERY_INVALID_VALUE",
      detail: "'sort' must be a comma-separated field list.",
    });
    return [];
  }
  const result: Sort<Entity>[] = [];
  for (const token of raw.split(",")) {
    if (token === "") continue;
    const descending = token.startsWith("-");
    const field = descending ? token.slice(1) : token;
    if (
      requireAllowlisted(field, config.allowlists.sortable, "sorting", issues)
    ) {
      result.push({
        field: field as FieldPath<Entity>,
        direction: descending ? "desc" : "asc",
      });
    }
  }
  return result;
}

function parseFields<Entity>(
  rawParams: Readonly<Record<string, unknown>>,
  config: ResolvedEntityConfig<Entity>,
  issues: QueryIssueDto[],
): FieldSelection<Entity> {
  for (const key of Object.keys(rawParams)) {
    if (parseBracketKey(key, "fields") !== null) {
      // fields[<relation>] only makes sense with includes (Phase 16).
      issues.push(unsupportedIssue("fields[relation]"));
    }
  }
  const raw = rawParams["fields"];
  if (raw === undefined || raw === null || raw === "") {
    return { root: null, relations: {} };
  }
  if (typeof raw !== "string") {
    issues.push({
      field: "fields",
      code: "CRUDO_QUERY_INVALID_VALUE",
      detail: "'fields' must be a comma-separated field list.",
    });
    return { root: null, relations: {} };
  }
  const root: FieldPath<Entity, 1>[] = [];
  for (const field of raw.split(",")) {
    if (field === "") continue;
    if (
      requireAllowlisted(
        field,
        config.allowlists.selectable,
        "selection",
        issues,
      )
    ) {
      root.push(field as FieldPath<Entity, 1>);
    }
  }
  return { root, relations: {} };
}

function validateExpression<Entity>(
  expression: FilterExpression<Entity>,
  config: ResolvedEntityConfig<Entity>,
  issues: QueryIssueDto[],
  depth = 1,
): void {
  if (depth > config.settings.query.maxFilterDepth) {
    issues.push({
      field: "filter",
      code: "CRUDO_QUERY_LIMIT_EXCEEDED",
      detail: `Filter depth exceeds the configured maximum of ${config.settings.query.maxFilterDepth}.`,
    });
    return;
  }
  if (expression.kind === "condition") {
    requireAllowlisted(
      expression.field as string,
      config.allowlists.filterable,
      "filtering",
      issues,
    );
    const value = expression.value;
    if (Array.isArray(value) && value.length > config.settings.query.maxInValues) {
      issues.push({
        field: expression.field as string,
        code: "CRUDO_QUERY_LIMIT_EXCEEDED",
        detail: `'${expression.operator}' carries ${value.length} values; the maximum is ${config.settings.query.maxInValues}.`,
      });
    }
    return;
  }
  for (const child of expression.children) {
    validateExpression(child, config, issues, depth + 1);
  }
}

function requireAllowlisted(
  field: string,
  allowlist: readonly unknown[],
  usage: "filtering" | "sorting" | "selection",
  issues: QueryIssueDto[],
): boolean {
  if ((allowlist as readonly string[]).includes(field)) return true;
  issues.push({
    field,
    code: "CRUDO_QUERY_INVALID_FIELD",
    detail: `Field '${field}' cannot be used for ${usage}.`,
  });
  return false;
}

function collectIssues(error: unknown, issues: QueryIssueDto[]): void {
  if (error instanceof QueryValidationException) {
    issues.push(...error.issues);
    return;
  }
  throw error;
}
