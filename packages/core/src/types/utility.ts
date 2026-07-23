/**
 * Internal type-level utilities shared across the core contracts.
 *
 * These are exported from the barrel because they appear in public
 * signatures (generic defaults, config shapes); they are not a general
 * utility library.
 */

/** Values that terminate a {@link FieldPath} — no recursion into these. */
export type Primitive = string | number | boolean | bigint | Date | null | undefined;

/** `true` when `T` is exactly `any` (the classic `0 extends 1 & T` probe). */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/** `true` when `T` is exactly `unknown` (and not `any`). */
export type IsUnknown<T> = unknown extends T ? (IsAny<T> extends true ? false : true) : false;

/**
 * Recursive partial used for configuration *input* scopes (global, entity,
 * operation, per-call). Resolved configuration is always complete — see
 * `ResolvedEntityConfig`.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Property keys of `T` that are not methods. */
export type NonFunctionKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [K in keyof T]-?: NonNullable<T[K]> extends Function ? never : K;
}[keyof T];

/**
 * The data shape of an entity: its properties minus methods. This is the
 * *type-level* default for the `create`/`update` DTO slots. The precise
 * runtime derivation (dropping generated columns and relation properties)
 * is metadata-driven and specified in Phase 4 — the type system cannot see
 * ORM metadata, so the static default is deliberately wider.
 */
export type EntityInput<Entity> = Pick<Entity, NonFunctionKeys<Entity> & keyof Entity>;

/**
 * Reference to a class (entity or DTO). The `never[]` parameter list makes
 * every concrete constructor assignable, regardless of its arguments.
 */
export type ClassRef<T = object> = abstract new (...args: never[]) => T;
