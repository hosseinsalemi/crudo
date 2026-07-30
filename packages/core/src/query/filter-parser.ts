import type { Filter } from "./filter.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";

/**
 * Parses raw wire filter parameters (the query-string grammar —
 * both bracket notation and the JSON escape hatch) into the filter AST.
 *
 * Parsing is where the security posture is enforced: fields are checked
 * against the entity's filterable allowlist, values are coerced against
 * column metadata, and tree depth / array-length limits are applied.
 * Violations raise `QueryValidationException` — never silent
 * drops.
 */
export interface FilterParser<Entity = unknown> {
  parse(rawParams: Readonly<Record<string, unknown>>, config: ResolvedEntityConfig<Entity>): Filter<Entity>;
}
