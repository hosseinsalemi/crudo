import type { CrudException, ErrorContext } from "./crud-exception.js";
import type { QueryIssueDto } from "./problem-details.js";
import type { CatalogedErrorCode } from "./error-catalog.js";
import { ERROR_CATALOG, renderMessage } from "./error-catalog.js";

/** Constructor input shared by every exception class. */
export interface CrudoExceptionOptions {
  readonly messageParams?: Readonly<Record<string, string | number>>;
  readonly context?: ErrorContext;
  readonly cause?: unknown;
}

/**
 * Base class of the exception hierarchy (Phase 6). Every leaf binds one
 * catalog code; status, title, and the English `detail` template all come
 * from the catalog, so an exception cannot disagree with it.
 *
 * Downstream layers should keep programming against the `CrudException`
 * *shape* (the `@crudo/nest` filter catches this class only as a
 * convenience at the HTTP boundary) — the hierarchy is extensible by
 * adding leaves, never by editing existing ones.
 */
export abstract class CrudoException extends Error implements CrudException {
  readonly code: CatalogedErrorCode;
  readonly status: number;
  readonly messageKey: string;
  readonly messageParams: Readonly<Record<string, string | number>>;
  readonly detail: string;
  readonly context: ErrorContext;
  override readonly cause?: unknown;

  protected constructor(code: CatalogedErrorCode, options: CrudoExceptionOptions = {}) {
    const params = options.messageParams ?? {};
    const detail = renderMessage(code, params);
    super(detail);
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    // The message key is the code itself: one stable identifier for both
    // machine handling and localization lookup.
    this.messageKey = code;
    this.messageParams = params;
    this.detail = detail;
    this.context = options.context ?? {};
    this.cause = options.cause;
  }
}

/**
 * Bad filter/sort/fields/pagination input (Phase 5 grammar violations).
 * Carries field-level issues that serialize into the problem-details
 * `errors[]` extension. The exception's own code is the generic
 * `CRUDO_QUERY_INVALID`; each issue carries its precise sub-code.
 */
export class QueryValidationException extends CrudoException {
  readonly issues: readonly QueryIssueDto[];

  constructor(issues: readonly QueryIssueDto[], options: CrudoExceptionOptions = {}) {
    super("CRUDO_QUERY_INVALID", options);
    this.issues = issues;
  }

  /** Convenience for the common single-issue case. */
  static single(issue: QueryIssueDto, options: CrudoExceptionOptions = {}): QueryValidationException {
    return new QueryValidationException([issue], options);
  }
}

export class NotFoundException extends CrudoException {
  constructor(options: CrudoExceptionOptions = {}) {
    super("CRUDO_NOT_FOUND", options);
  }
}

export class ConflictException extends CrudoException {
  constructor(options: CrudoExceptionOptions = {}) {
    super("CRUDO_CONFLICT", options);
  }
}

export class PersistenceException extends CrudoException {
  constructor(options: CrudoExceptionOptions = {}) {
    super("CRUDO_PERSISTENCE_FAILED", options);
  }
}

export class TransactionException extends CrudoException {
  /** Whether retrying the whole transaction may succeed (deadlocks do). */
  readonly retryable: boolean;

  constructor(options: CrudoExceptionOptions & { readonly retryable?: boolean } = {}) {
    super("CRUDO_TRANSACTION_FAILED", options);
    this.retryable = options.retryable ?? false;
  }
}

/** Soft-deleting a row that is already soft-deleted (Phase 14) → 409. */
export class AlreadyDeletedException extends CrudoException {
  constructor(options: CrudoExceptionOptions = {}) {
    super("CRUDO_ALREADY_DELETED", options);
  }
}

/**
 * Restoring — or purging — a row that is not deleted (Phase 14) → 409.
 * Both operations act on soft-deleted rows only; a live row is a state
 * conflict, not a missing one.
 */
export class NotDeletedException extends CrudoException {
  constructor(options: CrudoExceptionOptions = {}) {
    super("CRUDO_NOT_DELETED", options);
  }
}

/** Calling an operation whose registry entry is disabled (Phase 13). */
export class OperationDisabledException extends CrudoException {
  constructor(options: CrudoExceptionOptions = {}) {
    super("CRUDO_OPERATION_DISABLED", options);
  }
}

/**
 * Bootstrap-time configuration error. Never a wire response — it fires
 * before the app serves traffic, and it must name the entity, the key
 * path, and the offending value (Phase 8 error quality bar).
 */
export class ConfigurationException extends CrudoException {
  constructor(entity: string, path: string, problem: string) {
    super("CRUDO_CONFIG_INVALID", {
      messageParams: { entity, path, problem },
      context: { entityName: entity },
    });
  }
}
