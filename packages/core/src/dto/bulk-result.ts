import type { ProblemDetailsDto } from "../errors/problem-details.js";

/** One failed item of a best-effort bulk operation. */
export interface BulkItemFailureDto {
  /** Index of the item in the request payload. */
  readonly index: number;
  readonly error: ProblemDetailsDto;
}

/**
 * Envelope for `*Many` batch operations (Phase 14, if bulk is built;
 * reserved otherwise). Under `atomic` mode a batch either fully succeeds
 * or the whole request fails with a `BulkOperationException` — `failed` is
 * only ever populated under `bestEffort` mode.
 */
export interface BulkResultDto<ItemDto> {
  readonly succeeded: readonly ItemDto[];
  readonly failed: readonly BulkItemFailureDto[];
  readonly succeededCount: number;
  readonly failedCount: number;
}
