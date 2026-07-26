import type { OperationId } from "../operations/operation.js";

/**
 * Stable, string-based error code. Codes are API surface: the full catalog
 * (code → HTTP status → when it fires → payload extensions) is defined in
 * Phase 6, and renaming a code is a breaking change (Phase 18 semver
 * policy).
 */
export type KavoErrorCode = `KAVO_${string}`;

/** Where an error happened — attached to exceptions and problem details. */
export interface ErrorContext {
  readonly entityName?: string;
  readonly operation?: OperationId;
  readonly correlationId?: string;
}

/**
 * Contract every Kavo exception class (Phase 6) satisfies. Deliberately
 * an interface, not a base class: `@kavo/core` in Milestone A ships types
 * only, and downstream layers (the `@kavo/nest` exception filter) program
 * against this shape, never against `instanceof`.
 *
 * Human-readable text is built from `messageKey` + `messageParams` so a
 * consumer can localize; `detail` carries the English default.
 */
export interface CrudException {
  readonly code: KavoErrorCode;
  /** HTTP status this error maps to (from the Phase 6 catalog). */
  readonly status: number;
  readonly messageKey: string;
  readonly messageParams: Readonly<Record<string, string | number>>;
  readonly detail: string;
  readonly context: ErrorContext;
  /**
   * The original error when this wraps an adapter/driver failure — never
   * swallowed. Whether it leaks into responses is governed by the
   * `errors.exposeInternals` setting (off by default).
   */
  readonly cause?: unknown;
}

/**
 * Maps arbitrary thrown values to Kavo exceptions at the engine boundary.
 * Adapter errors are translated by the adapter's own mapping table
 * (Phase 9); anything unrecognized becomes a `PersistenceException` with
 * the original as `cause`.
 */
export interface ErrorHandler {
  handle(error: unknown, context: ErrorContext): CrudException;
}
