import type { FieldSelection, FieldSelectionInput } from "./field-selection.js";
import type { Filter, FilterExpression } from "./filter.js";
import type { NormalizedQueryContext, QueryContext } from "./query-context.js";
import type { CursorPagination, Pagination, PaginationStrategy } from "./pagination.js";
import type { Sort } from "./sort.js";
import type { FieldPath } from "../types/field-path.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { EntityMetadata, FieldMetadata } from "../metadata/entity-metadata.js";
import type { QueryIssueDto } from "../errors/problem-details.js";
import type { IncludeResolver } from "../relations/include-resolver.js";
import type { IncludeTree } from "../relations/include-tree.js";
import type { AllowlistUsage } from "../errors/message-hints.js";
import { ConfigurationException, QueryValidationException } from "../errors/exceptions.js";
import { pushAllowlistIssue } from "../errors/message-hints.js";
import { DefaultFilterParser } from "./default-filter-parser.js";
import { builtInPaginationStrategies } from "./pagination-strategies.js";
import { isCursorPagination } from "./pagination.js";
import { decodeCursor, keysetExpression } from "./cursor.js";
import { parseBracketKey } from "./bracket-notation.js";

/**
 * The normalization pipeline: raw query string → validated →
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
  private readonly includeResolver: IncludeResolver<Entity> | null;
  private readonly metadata: EntityMetadata<Entity>;
  private readonly fields: ReadonlyMap<string, FieldMetadata>;

  constructor(
    metadata: EntityMetadata<Entity>,
    extraStrategies: readonly PaginationStrategy[] = [],
    includeResolver: IncludeResolver<Entity> | null = null,
  ) {
    this.filterParser = new DefaultFilterParser(metadata);
    this.includeResolver = includeResolver;
    this.metadata = metadata;
    this.fields = new Map(metadata.fields.map((field) => [field.name, field]));
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

    const withDeleted = parseSoftDeleteFlag("withDeleted", rawParams["withDeleted"], config, issues);
    const onlyDeleted = parseSoftDeleteFlag("onlyDeleted", rawParams["onlyDeleted"], config, issues);
    if (withDeleted && onlyDeleted) issues.push(conflictingSoftDeleteFlagsIssue());

    let filter: Filter<Entity> = { root: null };
    try {
      filter = this.filterParser.parse(rawParams, config);
    } catch (error) {
      collectIssues(error, issues);
    }

    const clientSort = parseSort(rawParams["sort"], config, issues);
    const sort = clientSort.length > 0 ? clientSort : defaultSortOf(config);
    const fields = parseFields(rawParams, config, issues);
    const include = this.resolveIncludes(parseIncludePaths(rawParams["include"], issues), fields, config, issues);

    let pagination: Pagination<Entity> = { limit: 0, offset: 0 };
    try {
      pagination = this.strategyFor(config).normalize(rawParams, {
        defaultLimit: config.settings.pagination.defaultLimit,
        maxLimit: config.settings.pagination.maxLimit,
      }) as Pagination<Entity>;
    } catch (error) {
      collectIssues(error, issues);
    }
    // Keyset resolution runs *after* sort, not inside the strategy: a
    // strategy is handed raw params and limits alone, and widening its
    // signature to take sort and metadata would break every custom one
    // (ADR-0019).
    if (isCursorPagination(pagination)) {
      pagination = this.resolveKeyset(pagination, sort, config, issues);
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
      include,
      withDeleted,
      onlyDeleted,
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
    const withDeleted = parseSoftDeleteFlag("withDeleted", input.withDeleted, config, issues);
    const onlyDeleted = parseSoftDeleteFlag("onlyDeleted", input.onlyDeleted, config, issues);
    if (withDeleted && onlyDeleted) issues.push(conflictingSoftDeleteFlagsIssue());

    const root = input.filter ?? null;
    if (root !== null) {
      validateExpression(root, config, issues);
    }

    const clientSort = input.sort ?? [];
    for (const entry of clientSort) {
      requireAllowlisted(entry.field as string, config, "sorting", issues);
    }
    const sort = clientSort.length > 0 ? clientSort : defaultSortOf(config);

    const { root: rootFields, relations: relationFields } = collapseFieldSelection<Entity>(input.fields, issues);
    if (rootFields != null) {
      for (const field of rootFields) {
        requireAllowlisted(field as string, config, "selection", issues);
      }
    }
    const fields: FieldSelection<Entity> = {
      root: rootFields,
      relations: relationFields,
    };
    const include = this.resolveIncludes(input.include ?? [], fields, config, issues);

    const { defaultLimit, maxLimit } = config.settings.pagination;
    const limit = Math.min(input.limit ?? defaultLimit, maxLimit);
    const offset = input.offset ?? 0;
    if (limit < 1 || offset < 0 || !Number.isInteger(limit) || !Number.isInteger(offset)) {
      issues.push({
        field: limit < 1 || !Number.isInteger(limit) ? "limit" : "offset",
        code: "KAVO_QUERY_INVALID_VALUE",
        detail: `Pagination values must be integers (limit ≥ 1, offset ≥ 0).`,
      });
    }
    // The programmatic path does not run the strategy — its input is already
    // typed, so there is nothing to parse — but it must reach the *same*
    // normalized form, or calling the service directly would silently fall
    // back to offset paging on a cursor-configured entity.
    const cursorPaged = config.settings.pagination.strategy === "cursor";
    // Absent *or empty* means "first page", the same rule
    // `CursorPaginationStrategy` applies to the wire param — a caller
    // holding `nextCursor` in a string that starts out `""` must not get a
    // 400 where the equivalent `?cursor=` gets page one.
    const token = input.cursor === undefined || input.cursor === "" ? null : input.cursor;
    if (token !== null && !cursorPaged) {
      issues.push({
        field: "cursor",
        code: "KAVO_QUERY_UNSUPPORTED_PARAM",
        detail:
          `Query parameter 'cursor' is not supported: ${config.entityName} paginates with ` +
          `strategy '${config.settings.pagination.strategy}'. Set 'pagination.strategy' to 'cursor' to page by keyset.`,
      });
    }
    const pagination: Pagination<Entity> = cursorPaged
      ? this.resolveKeyset({ limit, cursor: token, keyset: null }, sort, config, issues)
      : { limit, offset };

    if (issues.length > 0) {
      throw new QueryValidationException(issues, {
        context: { entityName: config.entityName },
      });
    }
    return {
      filter: { root },
      sort,
      pagination,
      fields,
      include,
      withDeleted,
      onlyDeleted,
      count: config.settings.pagination.count,
    };
  }

  /**
   * Enforce what cursor pagination needs from the effective sort, then
   * decode the token against it.
   *
   * Keyset paging is only correct over a **total** order, and
   * `EntityMetadata` carries no uniqueness information beyond `idField`
   * (composite keys are out of scope) — so "ends in a unique tiebreaker"
   * is read here as "ends in the primary key", the one field Kavo can prove
   * unique. The other two rules exist for the same reason: a relation path
   * has no value to read off the returned row, and a `json` column has no
   * portable ordering.
   *
   * A *nullable* sort field is deliberately **not** rejected here. Whether
   * an ORM calls a column nullable is not a reliable signal (Mongoose
   * reports every non-`required` path that way), so rejecting on it would
   * make cursor paging unusable rather than safe. The narrower, accurate
   * rule lives in `decodeCursor` instead: a cursor may not carry `null` for
   * any key, so paging works until it actually reaches a row with a null
   * sort key, and then says so (ADR-0019).
   */
  private resolveKeyset(
    pagination: CursorPagination<Entity>,
    sort: readonly Sort<Entity>[],
    config: ResolvedEntityConfig<Entity>,
    issues: QueryIssueDto[],
  ): CursorPagination<Entity> {
    const { idField } = this.metadata;
    const before = issues.length;
    for (const entry of sort) {
      const field = this.fields.get(entry.field as string);
      if (field === undefined) {
        issues.push(cursorSortIssue(entry.field as string, "is not a scalar column of this entity"));
      } else if (field.kind === "json") {
        issues.push(cursorSortIssue(field.name, "is a 'json' column, which has no portable ordering"));
      }
    }
    if (sort.length === 0 || sort[sort.length - 1]!.field !== idField) {
      issues.push({
        field: "sort",
        code: "KAVO_QUERY_CONFLICTING_PARAMS",
        detail:
          `Cursor pagination needs a total order, so the effective sort must end in the unique field ` +
          `'${idField}' — e.g. 'sort=-createdAt,${idField}'. ` +
          (sort.length === 0
            ? `This request has no sort and ${config.entityName} declares no 'query.defaultSort'.`
            : `This request sorts by '${sort.map((entry) => entry.field as string).join(", ")}'.`),
      });
    }
    // A cursor decoded against a sort that was itself rejected would report
    // a second, misleading issue ("3 values but the sort has 2"), so the
    // first page's worth of problems is reported alone.
    if (issues.length > before || pagination.cursor === null) return pagination;
    const values = decodeCursor(pagination.cursor, sort, this.fields, issues);
    if (values === null) return pagination;
    return { ...pagination, keyset: keysetExpression(sort, values) };
  }

  /**
   * Hand the parsed paths and per-relation fieldsets to the resolver,
   * which owns every relation rule. Without a resolver there is
   * no relation graph to validate against, so an `include` is rejected
   * rather than quietly dropped.
   */
  private resolveIncludes(
    paths: readonly string[],
    fields: FieldSelection<Entity>,
    config: ResolvedEntityConfig<Entity>,
    issues: QueryIssueDto[],
  ): IncludeTree {
    const relationFields = fields.relations;
    if (paths.length === 0 && Object.keys(relationFields).length === 0 && !hasDefaultIncludes(config)) {
      return {};
    }
    if (this.includeResolver === null) {
      issues.push(unsupportedIssue("include"));
      return {};
    }
    try {
      return this.includeResolver.resolve({ paths, fields: relationFields }, config);
    } catch (error) {
      collectIssues(error, issues);
      return {};
    }
  }

  private strategyFor(config: ResolvedEntityConfig<Entity>): PaginationStrategy {
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

/** Why one effective-sort entry disqualifies the whole request from keyset paging. */
function cursorSortIssue(field: string, reason: string): QueryIssueDto {
  return {
    field: "sort",
    code: "KAVO_QUERY_CONFLICTING_PARAMS",
    detail: `Cursor pagination cannot order by '${field}': it ${reason}.`,
  };
}

function unsupportedIssue(param: string): QueryIssueDto {
  return {
    field: param,
    code: "KAVO_QUERY_UNSUPPORTED_PARAM",
    detail: `Query parameter '${param}' is not supported: this entity has no relation graph to resolve it against.`,
  };
}

/** Whether anything would be included even with an empty request. */
function hasDefaultIncludes<Entity>(config: ResolvedEntityConfig<Entity>): boolean {
  return config.relations.all().some((relation) => relation.defaultInclude === true && relation.includable);
}

/** `include=posts.comments,profile`, or the repeated-key array form. */
function parseIncludePaths(raw: unknown, issues: QueryIssueDto[]): readonly string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const tokens = Array.isArray(raw) ? raw : [raw];
  const paths: string[] = [];
  for (const token of tokens) {
    if (typeof token !== "string") {
      issues.push({
        field: "include",
        code: "KAVO_QUERY_INVALID_VALUE",
        detail: "'include' must be a comma-separated list of relation paths.",
      });
      continue;
    }
    for (const path of token.split(",")) {
      if (path !== "") paths.push(path);
    }
  }
  return paths;
}

/**
 * `withDeleted` / `onlyDeleted`: opt out of the default exclusion of
 * soft-deleted rows, or narrow a read to only them. Asking for either on an
 * entity that resolves to a hard delete strategy is rejected rather than
 * silently ignored — a client that thinks it is seeing deleted rows should
 * be told it is not. Setting both together is a separate conflict check
 * (see {@link conflictingSoftDeleteFlagsIssue}), since each is individually
 * valid on a soft-deletable entity.
 */
function parseSoftDeleteFlag<Entity>(
  field: "withDeleted" | "onlyDeleted",
  raw: unknown,
  config: ResolvedEntityConfig<Entity>,
  issues: QueryIssueDto[],
): boolean {
  if (raw === undefined || raw === null || raw === "" || raw === false || raw === "false" || raw === "0") {
    return false;
  }
  if (raw !== true && raw !== "true" && raw !== "1") {
    issues.push({
      field,
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: `Value '${String(raw)}' for field '${field}' is not a valid boolean.`,
    });
    return false;
  }
  if (config.softDelete.strategy !== "soft") {
    issues.push({
      field,
      code: "KAVO_QUERY_UNSUPPORTED_PARAM",
      detail:
        `Query parameter '${field}' is not supported: ` +
        `${config.entityName} is not soft-deletable, so no rows are excluded.`,
    });
    return false;
  }
  return true;
}

/** `withDeleted=true` and `onlyDeleted=true` together is a contradiction: "everything" vs. "only the deleted". */
function conflictingSoftDeleteFlagsIssue(): QueryIssueDto {
  return {
    field: "onlyDeleted",
    code: "KAVO_QUERY_CONFLICTING_PARAMS",
    detail:
      "Query parameters 'withDeleted' and 'onlyDeleted' cannot be used together: " +
      "'withDeleted' includes both live and deleted rows, while 'onlyDeleted' restricts to deleted rows only.",
  };
}

/**
 * `config.settings.query.defaultSort` — validated against the sortable
 * allowlist wherever it's set (`resolveEntityConfig` at bootstrap for
 * entity/operation scope, `KavoEngine.configViewFor` for per-call scope),
 * so it's applied here as-is rather than re-checked per request.
 */
function defaultSortOf<Entity>(config: ResolvedEntityConfig<Entity>): readonly Sort<Entity>[] {
  return config.settings.query.defaultSort as unknown as readonly Sort<Entity>[];
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
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: "'sort' must be a comma-separated field list.",
    });
    return [];
  }
  const result: Sort<Entity>[] = [];
  for (const token of raw.split(",")) {
    if (token === "") continue;
    const descending = token.startsWith("-");
    const field = descending ? token.slice(1) : token;
    if (requireAllowlisted(field, config, "sorting", issues)) {
      result.push({
        field: field as FieldPath<Entity>,
        direction: descending ? "desc" : "asc",
      });
    }
  }
  return result;
}

/**
 * Collapse the three caller-facing `fields` spellings into the canonical
 * `{ root, relations }` pair — the programmatic mirror of what
 * {@link parseFields} does for wire params.
 *
 * Discrimination is structural and in this order: an array is root-only
 * sugar; an object naming `root` or `relations` is the structured form;
 * anything else is relation-keyed. That is what makes `root` and
 * `relations` reserved keys (documented on `FieldSelectionInput`).
 *
 * Shape validation *is* part of this function — unlike the rest of the
 * fieldset (which the caller allowlist-checks and the include resolver
 * validates), a malformed `fields` value has no later gate to catch it, so
 * this is the one place it can be. A non-object value or a structured
 * literal mixing in a relation-keyed key both fail the same way `parseFields`
 * fails the equivalent wire input: an issue, not a thrown error — nothing
 * here may throw, or it surfaces as a 500 instead of a 400.
 */
function collapseFieldSelection<Entity>(
  input: FieldSelectionInput<Entity> | undefined,
  issues: QueryIssueDto[],
): {
  readonly root: readonly FieldPath<Entity, 1>[] | null;
  readonly relations: Readonly<Record<string, readonly string[]>>;
} {
  if (input === undefined) return { root: null, relations: {} };
  if (Array.isArray(input)) {
    return { root: input as readonly FieldPath<Entity, 1>[], relations: {} };
  }
  if (input === null || typeof input !== "object") {
    issues.push({
      field: "fields",
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: "'fields' must be an array, or an object of relation fieldsets.",
    });
    return { root: null, relations: {} };
  }
  const structured = input as Partial<FieldSelection<Entity>>;
  if ("root" in structured || "relations" in structured) {
    const unknownKeys = Object.keys(structured).filter((key) => key !== "root" && key !== "relations");
    for (const key of unknownKeys) {
      issues.push({
        field: `fields.${key}`,
        code: "KAVO_QUERY_INVALID_VALUE",
        detail: `'fields.${key}' cannot be mixed with 'root'/'relations' — use 'relations.${key}' instead.`,
      });
    }
    return { root: structured.root ?? null, relations: structured.relations ?? {} };
  }
  return { root: null, relations: input as Readonly<Record<string, readonly string[]>> };
}

function parseFields<Entity>(
  rawParams: Readonly<Record<string, unknown>>,
  config: ResolvedEntityConfig<Entity>,
  issues: QueryIssueDto[],
): FieldSelection<Entity> {
  // `fields[posts.comments]=id,body` — the key is the relation path. The
  // include resolver validates it against the *target* entity's allowlist,
  // so nothing beyond shape is checked here.
  //
  // Null-prototype, for the same reason the filter parser builds its tree
  // that way: the key is attacker-controlled, and `relations["__proto__"] =
  // [...]` on an ordinary object invokes the prototype setter — the fieldset
  // silently vanishes instead of reaching the resolver and being rejected.
  const relations: Record<string, readonly string[]> = Object.create(null);
  for (const key of Object.keys(rawParams)) {
    const segments = parseBracketKey(key, "fields");
    if (segments === null || segments.length !== 1 || segments[0] === "") continue;
    const value = rawParams[key];
    if (typeof value !== "string") {
      issues.push({
        field: key,
        code: "KAVO_QUERY_INVALID_VALUE",
        detail: `'${key}' must be a comma-separated field list.`,
      });
      continue;
    }
    relations[segments[0]!] = value.split(",").filter((field) => field !== "");
  }

  const raw = rawParams["fields"];
  if (raw === undefined || raw === null || raw === "") {
    return { root: null, relations };
  }
  if (typeof raw !== "string") {
    issues.push({
      field: "fields",
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: "'fields' must be a comma-separated field list.",
    });
    return { root: null, relations };
  }
  const root: FieldPath<Entity, 1>[] = [];
  for (const field of raw.split(",")) {
    if (field === "") continue;
    if (requireAllowlisted(field, config, "selection", issues)) {
      root.push(field as FieldPath<Entity, 1>);
    }
  }
  return { root, relations };
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
      code: "KAVO_QUERY_LIMIT_EXCEEDED",
      detail: `Filter depth exceeds the configured maximum of ${config.settings.query.maxFilterDepth}.`,
    });
    return;
  }
  if (expression.kind === "condition") {
    requireAllowlisted(expression.field as string, config, "filtering", issues);
    const value = expression.value;
    if (Array.isArray(value) && value.length > config.settings.query.maxInValues) {
      issues.push({
        field: expression.field as string,
        code: "KAVO_QUERY_LIMIT_EXCEEDED",
        detail: `'${expression.operator}' carries ${value.length} values; the maximum is ${config.settings.query.maxInValues}.`,
      });
    }
    return;
  }
  for (const child of expression.children) {
    validateExpression(child, config, issues, depth + 1);
  }
}

/** Which allowlist each usage reads, so the caller names only the usage. */
const ALLOWLIST_FOR: Readonly<Record<AllowlistUsage, "filterable" | "sortable" | "selectable">> = Object.freeze({
  filtering: "filterable",
  sorting: "sortable",
  selection: "selectable",
});

/**
 * The single allowlist gate for the programmatic entry point and the wire
 * one alike. On rejection the issue names the near miss, the permitted set,
 * and the config key that would permit the field — the leading sentence is
 * unchanged, everything actionable is appended.
 */
function requireAllowlisted<Entity>(
  field: string,
  config: ResolvedEntityConfig<Entity>,
  usage: AllowlistUsage,
  issues: QueryIssueDto[],
): boolean {
  const allowed = config.allowlists[ALLOWLIST_FOR[usage]] as readonly string[];
  if (allowed.includes(field)) return true;
  pushAllowlistIssue(field, usage, config.entityName, allowed, issues);
  return false;
}

function collectIssues(error: unknown, issues: QueryIssueDto[]): void {
  if (error instanceof QueryValidationException) {
    issues.push(...error.issues);
    return;
  }
  throw error;
}
