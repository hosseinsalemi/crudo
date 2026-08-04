import type { CursorPagination, OffsetPagination, PaginationLimits, PaginationStrategy } from "./pagination.js";
import { QueryValidationException } from "../errors/exceptions.js";

/**
 * The default strategy: flat `limit`/`offset` wire params —
 * the exact field names the `ListResultDto` envelope reports back, so a
 * request and its response read symmetrically.
 *
 * Missing `limit` falls back to `defaultLimit`; a `limit` above
 * `maxLimit` is clamped (the server never over-serves, and clamping is
 * kinder than rejecting for a shared-link use case); a malformed or
 * negative value is rejected — it's a client bug, not a preference.
 */
export class OffsetPaginationStrategy implements PaginationStrategy {
  readonly name = "offset";

  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): OffsetPagination {
    const limit = readBoundedInt(rawParams["limit"], "limit", 1);
    const offset = readBoundedInt(rawParams["offset"], "offset", 0);
    return {
      limit: Math.min(limit ?? limits.defaultLimit, limits.maxLimit),
      offset: offset ?? 0,
    };
  }
}

/**
 * Built-in alternative: `page[number]`/`page[size]`, 1-indexed, normalized
 * internally to the same `limit`/`offset` form (the envelope still
 * reports `limit`/`offset` — the internal form is the contract).
 */
export class PagePaginationStrategy implements PaginationStrategy {
  readonly name = "page";

  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): OffsetPagination {
    const number = readBoundedInt(rawParams["page[number]"], "page[number]", 1);
    const size = readBoundedInt(rawParams["page[size]"], "page[size]", 1);
    const limit = Math.min(size ?? limits.defaultLimit, limits.maxLimit);
    return {
      limit,
      offset: ((number ?? 1) - 1) * limit,
    };
  }
}

/**
 * Keyset pagination: flat `limit` plus an opaque `cursor` token naming the
 * previous page's last row (ADR-0019). `O(limit)` regardless of how deep the
 * page is, and stable under concurrent writes — the two things `offset`
 * cannot give.
 *
 * This is the whole of what the strategy can decide on its own: the token is
 * carried through verbatim and `keyset` left `null`, because decoding it
 * needs the effective sort and the entity metadata, neither of which
 * `normalize(rawParams, limits)` is handed. `QueryNormalizer` fills `keyset`
 * (and enforces the unique-tiebreaker requirement) immediately afterwards —
 * an adapter never sees a `CursorPagination` in this half-built state.
 */
export class CursorPaginationStrategy implements PaginationStrategy {
  readonly name = "cursor";

  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): CursorPagination {
    const limit = readBoundedInt(rawParams["limit"], "limit", 1);
    return {
      limit: Math.min(limit ?? limits.defaultLimit, limits.maxLimit),
      cursor: readCursorToken(rawParams["cursor"]),
      keyset: null,
    };
  }
}

/** Built-in strategies, keyed by the `pagination.strategy` config value. */
export function builtInPaginationStrategies(): ReadonlyMap<string, PaginationStrategy> {
  const strategies = [new OffsetPaginationStrategy(), new PagePaginationStrategy(), new CursorPaginationStrategy()];
  return new Map(strategies.map((strategy) => [strategy.name, strategy]));
}

/**
 * Absent/empty means "first page". Anything that is not a string is a
 * malformed request — a repeated `?cursor=a&cursor=b` arrives as an array,
 * and picking one of the two silently would page from an arbitrary place.
 */
function readCursorToken(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw QueryValidationException.single({
      field: "cursor",
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: "'cursor' must be a single opaque token, passed back from the previous page's 'meta.nextCursor'.",
    });
  }
  return raw;
}

function readBoundedInt(raw: unknown, param: string, minimum: number): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(String(raw));
  if (!Number.isInteger(value) || value < minimum) {
    throw QueryValidationException.single({
      field: param,
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: `'${param}' must be an integer ≥ ${minimum}, got '${String(raw)}'.`,
    });
  }
  return value;
}
