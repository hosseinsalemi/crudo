import type { KavoContext } from "../context/kavo-context.js";

/**
 * One computed (virtual) field: a response-only value derived from an
 * entity that has **already been fetched** (ADR-0019).
 *
 * A computed field has no backing column, so it exists at exactly one
 * stage of the pipeline — response mapping. `DefaultSerializer` calls
 * `resolve` for every served item instead of reading the key off the row,
 * which is what makes it behave identically for a TypeORM class instance
 * and a Prisma/Mongoose plain object. The three invariants that follow
 * from having no column are enforced at bootstrap, not at request time:
 * a computed field is never filterable, never sortable, and never
 * writable.
 *
 * ```ts
 * createCrud(User, {
 *   computed: {
 *     fullName: { resolve: (user) => `${user.firstName} ${user.lastName}` },
 *   },
 * });
 * ```
 */
export interface ComputedFieldDescriptor<Entity = unknown> {
  /**
   * Derive the field's value for one entity. Called once per served item,
   * **synchronously** — the return value is emitted as-is, never awaited.
   * Keep it a pure function of `entity` (plus, where a field has to vary by
   * caller, `context.principal`): a resolver that hits the database or the
   * network runs once per row and reintroduces exactly the N+1 the include
   * resolver exists to avoid.
   */
  resolve(entity: Entity, context: KavoContext<Entity>): unknown;
  /**
   * Whether the field joins the `selectable` allowlist, so `fields=` can
   * name it. Defaults to `true`; set `false` for a field that should always
   * be present and never individually selectable.
   */
  readonly selectable?: boolean;
}

/** A declared set of computed fields, keyed by the name they serialize as. */
export type ComputedFieldMap<Entity = unknown> = Readonly<Record<string, ComputedFieldDescriptor<Entity>>>;
