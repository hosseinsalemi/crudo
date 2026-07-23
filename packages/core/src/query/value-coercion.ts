import type { FieldKind, FieldMetadata } from "../metadata/entity-metadata.js";
import type { FilterScalar } from "./filter.js";
import type { QueryIssueDto } from "../errors/problem-details.js";

/**
 * Locale-independent wire-value coercion (Phase 5): raw query-string
 * values become typed AST values against entity column metadata, or
 * produce a field-level issue — never a silent `NaN`/`Invalid Date`.
 *
 * Documented conventions, per type:
 * - number: JavaScript number syntax (`42`, `-3.5`); no locale separators.
 * - boolean: `true`/`false`/`1`/`0`, exact.
 * - date: ISO 8601 (`2026-01-01`, `2026-01-01T10:00:00Z`).
 * - enum: exact member match.
 * - `null` (lowercase) coerces to SQL NULL for nullable columns.
 */
export function coerceScalar(
  raw: unknown,
  field: string,
  metadata: FieldMetadata | undefined,
): FilterScalar | QueryIssueDto {
  // Relation paths and unknown-but-allowlisted fields have no local column
  // metadata in Milestone B; their values pass through as strings and the
  // database compares them (Phase 16 wires target-entity metadata).
  if (metadata === undefined) return String(raw);

  if (raw === null || raw === "null") {
    if (metadata.nullable) return null;
    return issue(field, `null (column is not nullable)`, metadata.kind);
  }
  const text = String(raw);
  switch (metadata.kind) {
    case "string":
      return text;
    case "number": {
      const value = Number(text);
      if (text.trim() === "" || Number.isNaN(value)) {
        return issue(field, text, "number");
      }
      return value;
    }
    case "boolean": {
      if (text === "true" || text === "1") return true;
      if (text === "false" || text === "0") return false;
      return issue(field, text, "boolean");
    }
    case "date": {
      const value = new Date(text);
      if (Number.isNaN(value.getTime())) {
        return issue(field, text, "ISO 8601 date");
      }
      return value;
    }
    case "enum": {
      if (metadata.enumValues?.includes(text)) return text;
      return issue(
        field,
        text,
        `member of [${(metadata.enumValues ?? []).join(", ")}]`,
      );
    }
    case "json":
      return issue(field, text, "filterable column (json columns cannot be compared)");
  }
}

export function isIssue(
  value: FilterScalar | QueryIssueDto,
): value is QueryIssueDto {
  return (
    typeof value === "object" && value !== null && !(value instanceof Date)
  );
}

function issue(
  field: string,
  value: string,
  expected: FieldKind | string,
): QueryIssueDto {
  return {
    field,
    code: "CRUDO_QUERY_INVALID_VALUE",
    detail: `Value '${value}' for field '${field}' is not a valid ${expected}.`,
  };
}
