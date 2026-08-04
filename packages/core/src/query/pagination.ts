import type { FilterExpression } from "./filter.js";

/**
 * Offset semantics: "skip `offset` rows, then take `limit`". Produced by the
 * built-in `offset` and `page` strategies, whose wire spellings differ but
 * whose meaning does not.
 *
 * `limit`/`offset` are also the envelope field names in `ListResultDto`, so
 * request, internal form, and response mirror each other.
 */
export interface OffsetPagination {
  /** Effective page size, after clamping to the configured `maxLimit`. */
  readonly limit: number;
  /** Zero-based index of the first returned row within the match set. */
  readonly offset: number;
}

/**
 * Keyset semantics: "take `limit` rows ordered after the row the cursor
 * names". There is deliberately **no `offset`** — a keyset page has no
 * absolute position in the match set, and inventing a zero here would hand
 * every adapter a meaningless number to translate (ADR-0019).
 */
export interface CursorPagination<Entity = unknown> {
  /** Effective page size, after clamping to the configured `maxLimit`. */
  readonly limit: number;
  /**
   * The opaque token the client sent, verbatim; `null` on the first page.
   * Opaque, **not** signed — see ADR-0019 for why a forged cursor grants
   * nothing `filter[…]` does not already grant.
   */
  readonly cursor: string | null;
  /**
   * The decoded cursor as a ready-to-compose keyset predicate over the
   * effective sort — an `OR` of `AND` chains, so mixed `asc`/`desc` sorts
   * translate without any adapter reimplementing row-wise comparison.
   *
   * Filled by `QueryNormalizer`, the only component that knows the effective
   * sort: a `PaginationStrategy` sees raw params alone, so the value it
   * returns here is always `null`. `null` also means "first page".
   *
   * Adapters should not read this directly — `readFilter(query)` composes it
   * with the client filter, and `count` deliberately leaves it out.
   */
  readonly keyset: FilterExpression<Entity> | null;
}

/**
 * Normalized pagination — the internal form every strategy produces and
 * every adapter consumes.
 *
 * A **union**, not one shape (ADR-0019): offset and keyset paging are
 * different enough that collapsing them costs correctness. Narrow with
 * {@link isCursorPagination} before reading `offset`.
 */
export type Pagination<Entity = unknown> = OffsetPagination | CursorPagination<Entity>;

/** Limits a strategy must respect, sourced from resolved config. */
export interface PaginationLimits {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

/**
 * Narrow {@link Pagination} to its keyset variant. The discriminant is the
 * presence of `cursor`, not a `kind` tag: that keeps `OffsetPagination`
 * structurally identical to the pre-union shape, so every existing producer
 * — including third-party strategies — stays assignable untouched.
 */
export function isCursorPagination<Entity>(pagination: Pagination<Entity>): pagination is CursorPagination<Entity> {
  return "cursor" in pagination;
}

/**
 * Pluggable translation from wire pagination params to {@link Pagination}.
 * Built-ins: `offset` (flat `limit`/`offset`, the default), `page`
 * (`page[number]`/`page[size]`, 1-indexed), and `cursor` (`limit` plus an
 * opaque `cursor` token). A strategy may publish extra response data through
 * `ListMetaDto` (`meta.nextCursor`) — the envelope contract itself never
 * changes per strategy.
 */
export interface PaginationStrategy {
  /** Strategy id referenced by config (`pagination.strategy`). */
  readonly name: string;
  /**
   * Normalize raw wire params. Missing params fall back to `defaultLimit`;
   * out-of-range values are clamped or rejected per the query grammar.
   *
   * A strategy that returns a {@link CursorPagination} leaves `keyset` at
   * `null`; the normalizer fills it once the effective sort is known.
   */
  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): Pagination;
}
