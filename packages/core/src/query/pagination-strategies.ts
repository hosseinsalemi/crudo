import type { Pagination, PaginationLimits, PaginationStrategy } from "./pagination.js";
import { QueryValidationException } from "../errors/exceptions.js";

/**
 * The default strategy (Phase 5): flat `limit`/`offset` wire params —
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

  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): Pagination {
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

  normalize(rawParams: Readonly<Record<string, unknown>>, limits: PaginationLimits): Pagination {
    const number = readBoundedInt(rawParams["page[number]"], "page[number]", 1);
    const size = readBoundedInt(rawParams["page[size]"], "page[size]", 1);
    const limit = Math.min(size ?? limits.defaultLimit, limits.maxLimit);
    return {
      limit,
      offset: ((number ?? 1) - 1) * limit,
    };
  }
}

/** Built-in strategies, keyed by the `pagination.strategy` config value. */
export function builtInPaginationStrategies(): ReadonlyMap<string, PaginationStrategy> {
  const strategies = [new OffsetPaginationStrategy(), new PagePaginationStrategy()];
  return new Map(strategies.map((strategy) => [strategy.name, strategy]));
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
