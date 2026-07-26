import type { ClassRef } from "@kavo/core";

/**
 * Schema hints let a DTO field carry richer OpenAPI shape than its plain
 * initializer value conveys — an enum's allowed values, or the variants of a
 * `oneOf` array.
 *
 * A hint is a marker object stored as the field's initializer. Core's
 * serializer/deserializer only read DTO *keys* (never values), so the marker
 * never reaches a request or response — only the Swagger layer inspects it
 * (see `jsonSchemaForValue` in `swagger.ts`). The field keeps its declared
 * TypeScript type via each helper's return type.
 */
const SCHEMA_HINT = Symbol.for("kavo.nest.schemaHint");

/** The shape a schema hint documents. */
export type SchemaHint =
  | {
      readonly kind: "enum";
      readonly values: readonly (string | number)[];
      readonly numeric: boolean;
      readonly example?: string | number;
    }
  | { readonly kind: "oneOfArray"; readonly variants: readonly ClassRef[] };

interface Hinted {
  readonly [SCHEMA_HINT]: SchemaHint;
}

/** True when a DTO field value is a schema-hint marker. */
export function isSchemaHint(value: unknown): value is Hinted {
  return typeof value === "object" && value !== null && SCHEMA_HINT in value;
}

/** Read the hint a marker carries (call only after `isSchemaHint`). */
export function readSchemaHint(value: Hinted): SchemaHint {
  return value[SCHEMA_HINT];
}

/**
 * Document a DTO field as a string/number enum: Swagger emits `enum: [...]`
 * with the allowed values. Pass the value list (e.g. `Object.values(MyEnum)`);
 * the field keeps its declared type via the return type.
 */
export function enumProp<T extends string | number>(values: readonly T[], options?: { example?: T }): T {
  const hint: SchemaHint = {
    kind: "enum",
    values: [...values],
    numeric: typeof values[0] === "number",
    ...(options?.example !== undefined ? { example: options.example } : {}),
  };
  return { [SCHEMA_HINT]: hint } as unknown as T;
}

/**
 * Document a DTO array field whose elements are one of several DTO shapes:
 * Swagger emits `{ type: "array", items: { oneOf: [...] } }`. Each variant is
 * a DTO class documented by its runtime shape.
 */
export function oneOfArray<T extends object>(variants: readonly ClassRef<T>[]): T[] {
  const hint: SchemaHint = { kind: "oneOfArray", variants: [...variants] };
  return { [SCHEMA_HINT]: hint } as unknown as T[];
}
