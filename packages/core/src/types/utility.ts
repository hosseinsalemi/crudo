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
  [K in keyof T]?: DeepPartialValue<T[K]>;
};

/**
 * The per-property half of {@link DeepPartial}, split out so the naked
 * type parameter makes the conditional *distributive*: a union-typed
 * setting like `SoftDeleteSettings | false` partializes the object branch
 * and keeps the literal one, instead of matching neither and staying
 * required.
 */
type DeepPartialValue<V> = V extends readonly unknown[] ? V : V extends object ? DeepPartial<V> : V;

/** Property keys of `T` that are not methods. */
export type NonFunctionKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [K in keyof T]-?: NonNullable<T[K]> extends Function ? never : K;
}[keyof T];

/**
 * Property keys of `T` whose values are scalars: methods, arrays and nested
 * objects are all excluded.
 *
 * Relation-shaped properties are excluded deliberately, not for convenience.
 * ADR-0014 makes association by id the only write path, so a relation
 * *object* is never a valid write body — this is the type system agreeing
 * with the runtime rather than a separate opinion.
 */
export type ScalarKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [K in keyof T]-?: NonNullable<T[K]> extends Function
    ? never
    : NonNullable<T[K]> extends readonly unknown[]
      ? never
      : NonNullable<T[K]> extends Primitive
        ? K
        : never;
}[keyof T];

/**
 * The data shape of an entity for writes: its scalar properties, all
 * optional. This is the *type-level* default for the `create`/`update` DTO
 * slots.
 *
 * Every key is optional because only ORM metadata knows which columns are
 * generated, defaulted or nullable, and the type system cannot see it — the
 * precise runtime derivation (dropping generated columns and relation
 * properties) is metadata-driven and specified in Phase 4. Requiring every
 * key made the zero-config write path unusable: `createCrud(User)` then
 * demanded `id` and every relation in the body. Registering a `create` DTO
 * restores full strictness, which is what a configured setup does.
 */
export type EntityInput<Entity> = Partial<Pick<Entity, ScalarKeys<Entity> & keyof Entity>>;

/**
 * Reference to a class (entity or DTO). The `never[]` parameter list makes
 * every concrete constructor assignable, regardless of its arguments.
 */
export type ClassRef<T = object> = abstract new (...args: never[]) => T;
