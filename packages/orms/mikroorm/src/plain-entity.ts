import { wrap } from "@mikro-orm/core";

/**
 * MikroORM entity instance → plain object, at the adapter boundary.
 *
 * This conversion is **required**, not a convenience. A MikroORM to-many
 * relation is a `Collection<T>`, not an array, and core's `DefaultSerializer`
 * branches on `Array.isArray` to decide whether an included relation is a
 * list or a single row — a `Collection` would fall down the single-row path
 * and serialize its internal fields instead of its items. `@kavo/mongoose`
 * converts documents at the same seam and for the same reason: core consumes
 * plain data, so the ORM's own row representation stops here.
 *
 * `wrap(entity).toObject()` is what performs it, which has two consequences
 * worth naming because they are behavior, not implementation detail:
 *
 * 1. **Unpopulated relations collapse to their primary key.** A to-one that
 *    was not populated comes back as the raw foreign key (`author: 1`) and a
 *    to-many as `[]`. That is harmless — core's serializer emits a relation
 *    key only for nodes on the request's include tree — and it is why a
 *    relation must be `include=`d to appear as an object.
 * 2. **MikroORM's own property options apply.** A custom `serializer` runs
 *    before core ever sees the row, and a `@Property({ hidden: true })` is
 *    dropped. The hidden case is belt-and-braces rather than the guard:
 *    `buildEntityMetadata` excludes such a property from the seam entirely,
 *    which is what keeps it off the default filter/sort allowlists too — a
 *    column invisible in the body but filterable in the database would be a
 *    blind extraction oracle. See doc 17, "Adapter-specific caveats".
 */
export function toPlain<Entity extends object>(entity: Entity): Entity {
  return wrap(entity).toObject() as Entity;
}

/** {@link toPlain} over a list, for the `findMany` path. */
export function toPlainAll<Entity extends object>(entities: readonly Entity[]): readonly Entity[] {
  return entities.map((entity) => toPlain(entity));
}
