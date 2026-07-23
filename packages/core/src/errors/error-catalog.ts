import type { CrudoErrorCode } from "./crud-exception.js";

/**
 * One catalog entry: everything stable about an error code. Codes are API
 * surface — renaming one is a breaking change (Phase 19 semver policy).
 * The full human-facing table lives in
 * packages/docs/architecture/06-error-handling.md and is generated from
 * this object, so code and docs cannot drift.
 */
export interface ErrorCatalogEntry {
  /** HTTP status the `@crudo/nest` filter responds with. */
  readonly status: number;
  /** RFC 9457 `title`: short, human-readable summary of the problem type. */
  readonly title: string;
  /**
   * English default for `detail`, interpolated with `{param}` placeholders
   * from `messageParams`. Consumers localize by re-rendering the same
   * `messageKey` + params; the key is always the error code itself.
   */
  readonly message: string;
}

/**
 * The complete Milestone B error catalog. Later phases only add entries
 * (`CRUDO_ALREADY_DELETED`, … are reserved now so the Phase 15 leaves slot
 * into an existing hierarchy without renumbering anything).
 */
export const ERROR_CATALOG = {
  CRUDO_QUERY_INVALID: {
    status: 400,
    title: "Invalid query",
    message: "The request query is invalid.",
  },
  CRUDO_QUERY_INVALID_FIELD: {
    status: 400,
    title: "Invalid query field",
    message: "Field '{field}' cannot be used for {usage}.",
  },
  CRUDO_QUERY_INVALID_OPERATOR: {
    status: 400,
    title: "Invalid filter operator",
    message: "Unknown filter operator '{operator}' on field '{field}'.",
  },
  CRUDO_QUERY_INVALID_VALUE: {
    status: 400,
    title: "Invalid query value",
    message: "Value '{value}' for field '{field}' is not a valid {expected}.",
  },
  CRUDO_QUERY_LIMIT_EXCEEDED: {
    status: 400,
    title: "Query limit exceeded",
    message: "{limit} exceeds the configured maximum of {max}.",
  },
  CRUDO_QUERY_UNSUPPORTED_PARAM: {
    status: 400,
    title: "Unsupported query parameter",
    message: "Query parameter '{param}' is not supported: {reason}",
  },
  CRUDO_NOT_FOUND: {
    status: 404,
    title: "Not found",
    message: "{entity} with id '{id}' was not found.",
  },
  CRUDO_CONFLICT: {
    status: 409,
    title: "Conflict",
    message: "The operation conflicts with the current state of {entity}.",
  },
  CRUDO_ALREADY_DELETED: {
    status: 409,
    title: "Already deleted",
    message: "{entity} with id '{id}' is already deleted.",
  },
  CRUDO_NOT_DELETED: {
    status: 409,
    title: "Not deleted",
    message: "{entity} with id '{id}' is not deleted and cannot be restored.",
  },
  CRUDO_OPERATION_DISABLED: {
    status: 405,
    title: "Operation disabled",
    message: "Operation '{operation}' is disabled for {entity}.",
  },
  CRUDO_BULK_FAILED: {
    status: 422,
    title: "Bulk operation failed",
    message: "{failedCount} of {totalCount} items failed.",
  },
  CRUDO_PERSISTENCE_FAILED: {
    status: 500,
    title: "Persistence failure",
    message: "The persistence layer failed while executing '{operation}'.",
  },
  CRUDO_TRANSACTION_FAILED: {
    status: 500,
    title: "Transaction failure",
    message: "The transaction could not be completed.",
  },
  CRUDO_CONFIG_INVALID: {
    status: 500,
    title: "Invalid configuration",
    message:
      "Invalid configuration for entity '{entity}' at '{path}': {problem}",
  },
} as const satisfies Record<CrudoErrorCode, ErrorCatalogEntry>;

/** A code present in the shipped catalog. */
export type CatalogedErrorCode = keyof typeof ERROR_CATALOG;

/** Render an English `detail` string from a catalog template and params. */
export function renderMessage(
  code: CatalogedErrorCode,
  params: Readonly<Record<string, string | number>>,
): string {
  return ERROR_CATALOG[code].message.replace(
    /\{(\w+)\}/g,
    (match, key: string) => {
      const value = params[key];
      return value === undefined ? match : String(value);
    },
  );
}
