import type { KavoErrorCode } from "./crud-exception.js";

/** One field-level query issue (`errors[]` extension). */
export interface QueryIssueDto {
  /** The offending field or parameter as it appeared on the wire. */
  readonly field: string;
  readonly code: KavoErrorCode;
  readonly detail: string;
}

/**
 * Default serialized error shape: an RFC 9457 problem-details document
 * with Kavo extensions. The `@kavo/nest` exception filter maps it 1:1;
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
  /** Kavo extension: the stable catalog code. */
  readonly code: KavoErrorCode;
  /** Kavo extension: field-level query issues (400s from query validation). */
  readonly errors?: readonly QueryIssueDto[];
}
