import type { KavoErrorCode } from "./crud-exception.js";

/**
 * One catalog entry: everything stable about an error code. Codes are API
 * surface — renaming one is a breaking change (Phase 18 semver policy).
 * The full human-facing table lives in
 * packages/docs/architecture/06-error-handling.md and is generated from
 * this object, so code and docs cannot drift.
 */
export interface ErrorCatalogEntry {
  /** HTTP status the `@kavo/nest` filter responds with. */
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
 * The complete error catalog. Later phases only add entries — the codes
 * here are API surface, and the soft-delete leaves (Phase 14) slotted
 * into the hierarchy reserved for them without renumbering anything.
 */
export const ERROR_CATALOG = {
  KAVO_QUERY_INVALID: {
    status: 400,
    title: "Invalid query",
    message: "The request query is invalid.",
  },
  KAVO_QUERY_INVALID_FIELD: {
    status: 400,
    title: "Invalid query field",
    message: "Field '{field}' cannot be used for {usage}.",
  },
  KAVO_QUERY_INVALID_OPERATOR: {
    status: 400,
    title: "Invalid filter operator",
    message: "Unknown filter operator '{operator}' on field '{field}'.",
  },
  KAVO_QUERY_INVALID_VALUE: {
    status: 400,
    title: "Invalid query value",
    message: "Value '{value}' for field '{field}' is not a valid {expected}.",
  },
  KAVO_QUERY_LIMIT_EXCEEDED: {
    status: 400,
    title: "Query limit exceeded",
    message: "{limit} exceeds the configured maximum of {max}.",
  },
  KAVO_QUERY_UNSUPPORTED_PARAM: {
    status: 400,
    title: "Unsupported query parameter",
    message: "Query parameter '{param}' is not supported: {reason}",
  },
  KAVO_NOT_FOUND: {
    status: 404,
    title: "Not found",
    message: "{entity} with id '{id}' was not found.",
  },
  KAVO_CONFLICT: {
    status: 409,
    title: "Conflict",
    message: "The operation conflicts with the current state of {entity}.",
  },
  KAVO_ALREADY_DELETED: {
    status: 409,
    title: "Already deleted",
    message: "{entity} with id '{id}' is already deleted.",
  },
  KAVO_NOT_DELETED: {
    status: 409,
    title: "Not deleted",
    message: "{entity} with id '{id}' is not deleted.",
  },
  KAVO_OPERATION_DISABLED: {
    status: 405,
    title: "Operation disabled",
    message: "Operation '{operation}' is disabled for {entity}.",
  },
  KAVO_PERSISTENCE_FAILED: {
    status: 500,
    title: "Persistence failure",
    message: "The persistence layer failed while executing '{operation}'.",
  },
  KAVO_TRANSACTION_FAILED: {
    status: 500,
    title: "Transaction failure",
    message: "The transaction could not be completed.",
  },
  KAVO_CONFIG_INVALID: {
    status: 500,
    title: "Invalid configuration",
    message: "Invalid configuration for entity '{entity}' at '{path}': {problem}",
  },
} as const satisfies Record<KavoErrorCode, ErrorCatalogEntry>;

/** A code present in the shipped catalog. */
export type CatalogedErrorCode = keyof typeof ERROR_CATALOG;

/** Render an English `detail` string from a catalog template and params. */
export function renderMessage(code: CatalogedErrorCode, params: Readonly<Record<string, string | number>>): string {
  return ERROR_CATALOG[code].message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
