/**
 * Normalize a parsed query object back to the flat bracket-key form the
 * Phase 5 grammar is specified against.
 *
 * Express 5 (Nest 11's default) uses the "simple" query parser, which
 * already yields flat keys (`"filter[age][gte]": "18"`). Express 4 / the
 * "extended" qs parser yields nested objects instead
 * (`{ filter: { age: { gte: "18" } } }`); flattening here makes the
 * binding parser-agnostic.
 */
export function flattenQuery(query: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    flattenInto(flat, key, value);
  }
  return flat;
}

function flattenInto(flat: Record<string, unknown>, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    // Repeated keys (`filter[status][in][]=a&…[]=b`) arrive as arrays in
    // both parsers; keep the array under the bracketed key. Top-level
    // scalars repeated by accident (`?limit=1&limit=2`) stay arrays too —
    // the normalizer rejects them with a clean 400.
    flat[key.endsWith("[]") || !key.includes("[") ? key : `${key}[]`] = value;
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [childKey, childValue] of Object.entries(value)) {
      flattenInto(flat, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  flat[key] = value;
}
