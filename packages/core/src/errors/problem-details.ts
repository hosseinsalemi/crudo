import type { CrudoErrorCode } from "./crud-exception.js";

/** One field-level query issue (`errors[]` extension). */
export interface QueryIssueDto {
  /** The offending field or parameter as it appeared on the wire. */
  readonly field: string;
  readonly code: CrudoErrorCode;
  readonly detail: string;
}

/** One per-index failure of a bulk request (`items[]` extension). */
export interface BulkItemIssueDto {
  readonly index: number;
  readonly code: CrudoErrorCode;
  readonly detail: string;
}

/**
 * Default serialized error shape: an RFC 9457 problem-details document
 * with Crudo extensions. The `@crudo/nest` exception filter maps it 1:1;
 * anyone who wants a different wire shape swaps the serializer, not the
 * exception hierarchy.
 */
export interface ProblemDetailsDto {
  /** URI reference identifying the problem type. */
  readonly type: string;
  readonly title: string;
  /** HTTP status code. */
  readonly status: number;
  readonly detail: string;
  /** URI reference identifying this occurrence (correlation). */
  readonly instance?: string;
  /** Crudo extension: the stable catalog code. */
  readonly code: CrudoErrorCode;
  /** Crudo extension: field-level query issues (400s from Phase 5). */
  readonly errors?: readonly QueryIssueDto[];
  /** Crudo extension: per-index bulk failures (Phase 15). */
  readonly items?: readonly BulkItemIssueDto[];
}
