import type { KavoExceptionShape, ErrorContext } from "./kavo-exception-shape.js";
import type { QueryIssueDto } from "./problem-details.js";
import type { CatalogedErrorCode } from "./error-catalog.js";
import { ERROR_CATALOG, renderMessage } from "./error-catalog.js";

/** Constructor input shared by every exception class. */
export interface KavoExceptionOptions {
  readonly messageParams?: Readonly<Record<string, string | number>>;
  readonly context?: ErrorContext;
  readonly cause?: unknown;
}

/**
 * Base class of the exception hierarchy. Every leaf binds one
 * catalog code; status, title, and the English `detail` template all come
 * from the catalog, so an exception cannot disagree with it.
 *
 * Downstream layers should keep programming against the `KavoExceptionShape`
 * *shape* (the `@kavo/nest` filter catches this class only as a
 * convenience at the HTTP boundary) — the hierarchy is extensible by
 * adding leaves, never by editing existing ones.
 */
export abstract class KavoException extends Error implements KavoExceptionShape {
  readonly code: CatalogedErrorCode;
  readonly status: number;
  readonly messageKey: string;
  readonly messageParams: Readonly<Record<string, string | number>>;
  readonly detail: string;
  readonly context: ErrorContext;
  override readonly cause?: unknown;

  protected constructor(code: CatalogedErrorCode, options: KavoExceptionOptions = {}) {
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
 * Bad filter/sort/fields/pagination input (query grammar violations).
 * Carries field-level issues that serialize into the problem-details
 * `errors[]` extension. The exception's own code is the generic
 * `KAVO_QUERY_INVALID`; each issue carries its precise sub-code.
 */
export class QueryValidationException extends KavoException {
  readonly issues: readonly QueryIssueDto[];

  constructor(issues: readonly QueryIssueDto[], options: KavoExceptionOptions = {}) {
    super("KAVO_QUERY_INVALID", options);
    this.issues = issues;
  }

  /** Convenience for the common single-issue case. */
  static single(issue: QueryIssueDto, options: KavoExceptionOptions = {}): QueryValidationException {
    return new QueryValidationException([issue], options);
  }
}

export class NotFoundException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_NOT_FOUND", options);
  }
}

export class ConflictException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_CONFLICT", options);
  }
}

export class PersistenceException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_PERSISTENCE_FAILED", options);
  }
}

export class TransactionException extends KavoException {
  /** Whether retrying the whole transaction may succeed (deadlocks do). */
  readonly retryable: boolean;

  constructor(options: KavoExceptionOptions & { readonly retryable?: boolean } = {}) {
    super("KAVO_TRANSACTION_FAILED", options);
    this.retryable = options.retryable ?? false;
  }
}

/** Soft-deleting a row that is already soft-deleted → 409. */
export class AlreadyDeletedException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_ALREADY_DELETED", options);
  }
}

/**
 * Restoring — or purging — a row that is not deleted → 409.
 * Both operations act on soft-deleted rows only; a live row is a state
 * conflict, not a missing one.
 */
export class NotDeletedException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_NOT_DELETED", options);
  }
}

/** Calling an operation whose registry entry is disabled. */
export class OperationDisabledException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_OPERATION_DISABLED", options);
  }
}

/**
 * Calling an operation the registry has no entry for at all — a misspelled
 * id, or a custom operation that was never registered. Distinct from
 * {@link OperationDisabledException} at the same 405: "disabled" says the
 * entry exists and can be switched on, which for a registry miss is simply
 * untrue, and `messageKey` (= the code) is what a localizing consumer
 * re-renders from.
 *
 * Unreachable over HTTP — route generation walks the same registry, so an
 * unregistered id has no route — which is exactly why the falsehood
 * survived: only programmatic callers ever saw it.
 */
export class OperationNotRegisteredException extends KavoException {
  constructor(options: KavoExceptionOptions = {}) {
    super("KAVO_OPERATION_NOT_REGISTERED", options);
  }
}

/**
 * Bootstrap-time configuration error. Never a wire response — it fires
 * before the app serves traffic, and it must name the entity, the key
 * path, and the offending value (error quality bar).
 */
export class ConfigurationException extends KavoException {
  constructor(entity: string, path: string, problem: string) {
    super("KAVO_CONFIG_INVALID", {
      messageParams: { entity, path, problem },
      context: { entityName: entity },
    });
  }
}
