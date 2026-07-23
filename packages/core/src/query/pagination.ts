/**
 * Normalized pagination — the single internal form every strategy produces
 * and every adapter consumes. `limit`/`offset` are also the envelope field
 * names in `ListResultDto`, so request, internal form, and response mirror
 * each other.
 */
export interface Pagination {
  /** Effective page size, after clamping to the configured `maxLimit`. */
  readonly limit: number;
  /** Zero-based index of the first returned row within the match set. */
  readonly offset: number;
}

/** Limits a strategy must respect, sourced from resolved config (Phase 8). */
export interface PaginationLimits {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

/**
 * Pluggable translation from wire pagination params to {@link Pagination}.
 * Built-ins (Phase 5): `offset` (flat `limit`/`offset`, the default) and
 * `page` (`page[number]`/`page[size]`, 1-indexed). A strategy may publish
 * extra response data through `ListMetaDto` (e.g. a cursor) — the envelope
 * contract itself never changes per strategy.
 */
export interface PaginationStrategy {
  /** Strategy id referenced by config (`pagination.strategy`). */
  readonly name: string;
  /**
   * Normalize raw wire params. Missing params fall back to `defaultLimit`;
   * out-of-range values are clamped or rejected per the Phase 5 grammar.
   */
  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): Pagination;
}
