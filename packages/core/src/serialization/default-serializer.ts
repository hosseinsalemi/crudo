import type { KavoContext } from "../context/kavo-context.js";
import type { ComputedFieldMap } from "../config/computed-field.js";
import type { DtoClass } from "../dto/dto.js";
import type { Deserializer, Serializer } from "./serializer.js";
import type { EntityCatalog } from "../metadata/entity-catalog.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import type { IncludeNode, IncludeTree } from "../relations/include-tree.js";
import { dtoShapeKeys } from "../dto/dto-shape.js";

/**
 * Computed fields as the projector consumes them: entity type erased,
 * because one serializer projects rows of several entity types — the
 * root's, and every included relation target's, which it reads off the
 * catalog. The entity-typed contract is `ComputedFieldDescriptor<Entity>`,
 * which is what the *caller* declares and what every `ComputedFieldMap`
 * flowing in here satisfies.
 */
type ErasedComputedFields = Readonly<Record<string, { resolve(entity: never, context: never): unknown }>>;

const NO_COMPUTED_FIELDS: ErasedComputedFields = Object.freeze({});

/** The projection rules for one entity type, resolved from the catalog. */
interface Projection {
  /** Allowed keys, or `null` when the shape is unknown (own keys apply). */
  readonly keys: readonly string[] | null;
  /** Relation property names — never emitted unless the node is included. */
  readonly relations: readonly string[];
  /** Computed fields, evaluated instead of read off the row (ADR-0019). */
  readonly computed: ErasedComputedFields;
}

/**
 * Default response mapping. Serialization order is normative:
 * **DTO mapping first, then field selection** — selection can only narrow
 * what the resolved DTO exposes.
 *
 * Projection sources, in order:
 * 1. An explicit DTO class with initialized fields → its key set.
 * 2. Otherwise the entity-derived default: every scalar column from
 *    adapter metadata, plus every declared computed field (ADR-0019).
 *
 * A key that names a computed field is produced by calling the
 * descriptor's `resolve`, never by reading it off the row — which is what
 * makes computed fields behave identically over a TypeORM class instance
 * and a Prisma/Mongoose plain object.
 *
 * Relation properties are emitted **only** for nodes on the request's
 * include tree, each projected through its own target entity's
 * DTO — a relation never widens what its target exposes. That is also why
 * a relation key on a registered DTO stays absent until it is included:
 * the DTO documents the shape, the include decides the load.
 */
export class DefaultSerializer<Entity = unknown> implements Serializer<Entity> {
  private readonly rootProjection: Projection;

  constructor(
    metadata: EntityMetadata<Entity>,
    private readonly catalog?: EntityCatalog,
    computed: ComputedFieldMap<Entity> = {},
  ) {
    this.rootProjection = {
      keys: [...metadata.fields.map((field) => field.name), ...Object.keys(computed)],
      relations: metadata.relations.map((relation) => relation.name),
      computed,
    };
  }

  serializeItem<ItemDto>(
    entity: Entity,
    dto: DtoClass<ItemDto & object> | null,
    context: KavoContext<Entity>,
  ): ItemDto {
    return this.project(
      entity,
      narrowToDto(this.rootProjection, dto),
      context.query?.fields.root as readonly string[] | null | undefined,
      context.query?.include ?? {},
      context,
    ) as ItemDto;
  }

  serializeList<ListDto>(
    entities: readonly Entity[],
    dto: DtoClass<ListDto & object> | null,
    context: KavoContext<Entity>,
  ): readonly ListDto[] {
    return entities.map((entity) => this.serializeItem(entity, dto as DtoClass<ListDto & object> | null, context));
  }

  /**
   * One entity → one plain object: allowed keys narrowed by the sparse
   * fieldset, then the included relations grafted on. Keys the adapter
   * fetched for stitching but nobody selected are dropped right here —
   * "kept internally, stripped late".
   */
  private project(
    entity: unknown,
    projection: Projection,
    selection: readonly string[] | null | undefined,
    include: IncludeTree,
    context: KavoContext<Entity>,
  ): Record<string, unknown> {
    const source = entity as Record<string, unknown>;
    const keys = projection.keys ?? Object.keys(source);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (projection.relations.includes(key)) continue;
      if (selection != null && !selection.includes(key)) continue;
      // Own properties only: `keys` can come from a DTO class or from the
      // row itself, and an inherited `constructor`/`toString` must not be
      // mistaken for a declared computed field.
      if (Object.prototype.hasOwnProperty.call(projection.computed, key)) {
        const value = projection.computed[key]?.resolve(entity as never, context as never);
        // `undefined` is absence, `null` is data — the same distinction the
        // column branch draws below, so a resolver that opts out of
        // emitting a value reads the same programmatically as it does once
        // `JSON.stringify` has dropped the key.
        if (value !== undefined) result[key] = value;
        continue;
      }
      if (key in source) result[key] = source[key];
    }
    for (const [name, node] of Object.entries(include)) {
      // Absent means "not loaded" — a programmatic caller can hand the
      // engine an entity the adapter never hydrated.
      if (!(name in source)) continue;
      result[name] = this.projectRelated(source[name], node, context);
    }
    return result;
  }

  private projectRelated(value: unknown, node: IncludeNode, context: KavoContext<Entity>): unknown {
    if (value === null || value === undefined) {
      return node.relation.cardinality === "many" ? [] : null;
    }
    const target = this.projectionFor(node);
    const one = (row: unknown): Record<string, unknown> =>
      this.project(row, target, node.fields, node.children, context);
    return Array.isArray(value) ? value.map(one) : one(value);
  }

  /**
   * The target entity's own projection: its registered `item` DTO (or
   * `list` for a to-many, which itself falls back to `item`), else the
   * target's columns plus its own computed fields — which is how a
   * computed field on an included relation resolves without this class
   * ever knowing more than one entity (ADR-0019).
   */
  private projectionFor(node: IncludeNode): Projection {
    const info = this.catalog?.get(node.relation.target());
    if (info === undefined) return { keys: null, relations: [], computed: NO_COMPUTED_FIELDS };
    const dto = info.config.dto.resolve(node.relation.cardinality === "many" ? "list" : "item", "findMany");
    const computed: ErasedComputedFields = info.config.computed;
    return {
      keys: dtoShapeKeys(dto) ?? [...info.metadata.fields.map((field) => field.name), ...Object.keys(computed)],
      relations: info.metadata.relations.map((relation) => relation.name),
      computed,
    };
  }
}

/**
 * DTO mapping, step one of the normative order: a registered class with a
 * runtime shape replaces the projection's key set and nothing else — the
 * relation and computed tables still describe the same entity, so a DTO
 * that names a computed field still gets it evaluated, and one that omits
 * it narrows it away like any other field.
 */
function narrowToDto(projection: Projection, dto: DtoClass | null): Projection {
  const keys = dtoShapeKeys(dto);
  return keys === null ? projection : { ...projection, keys };
}

/**
 * Default request-body mapping. Picks the keys the operation's
 * input shape allows and silently drops everything else — with no
 * validation subsystem in v6, stripping unknown and non-writable keys
 * (generated columns) is the safe default: a client cannot write `id` or
 * `createdAt` by including them in a body.
 *
 * Relation properties are writable **by association only** (ADR-0014):
 * a scalar id, an `{ id }` reference, or an array of either.
 * A nested object carrying more than the id is narrowed to the id, because
 * a deep nested write is not something this layer should do by accident.
 *
 * Computed fields are **never** writable (ADR-0019). Keeping them out of
 * the derived projection is not enough on its own: a registered
 * `create`/`update` DTO *replaces* that projection, so a DTO class naming
 * a computed field would otherwise pass the key straight through to the
 * adapter as if it were a column. They are stripped explicitly, whichever
 * projection is in force.
 */
export class DefaultDeserializer<Entity = unknown> implements Deserializer<Entity> {
  private readonly writableProjection: readonly string[];
  private readonly relationIdFields: ReadonlyMap<string, () => string | undefined>;
  private readonly computedNames: ReadonlySet<string>;

  constructor(metadata: EntityMetadata<Entity>, catalog?: EntityCatalog, computed: ComputedFieldMap<Entity> = {}) {
    this.computedNames = new Set(Object.keys(computed));
    const columns = metadata.fields.filter((field) => !field.generated).map((field) => field.name);
    const relations = new Map<string, () => string | undefined>();
    for (const relation of metadata.relations) {
      // Lazily: the target may enter the catalog after this entity does.
      relations.set(relation.name, () => catalog?.get(relation.target())?.metadata.idField);
    }
    this.relationIdFields = relations;
    // Relations join the derived default — associating by id is ordinary
    // CRUD, not an opt-in extra.
    this.writableProjection = [...columns, ...relations.keys()];
  }

  deserialize<Shape>(raw: unknown, dto: DtoClass<Shape & object> | null, _context: KavoContext<Entity>): Shape {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return {} as Shape;
    }
    const allowed = dtoShapeKeys(dto) ?? this.writableProjection;
    const source = raw as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of allowed) {
      // A computed field has no column behind it, so a value for it could
      // only ever reach the adapter as an unknown write (ADR-0019).
      if (this.computedNames.has(key)) continue;
      // Own properties only. `raw` is a wire body, so an inherited key is
      // never something the client sent — but it *is* something a polluted
      // `Object.prototype` would supply, silently adding a writable field to
      // every request that omits it. Defence in depth: the filter parser no
      // longer offers a way to pollute (see `emptyNode` there), and this
      // keeps a pollution introduced anywhere else out of writes.
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const idField = this.relationIdFields.get(key)?.();
      result[key] = idField === undefined ? source[key] : associate(source[key], idField);
    }
    return result as Shape;
  }
}

/** `5` → `{ id: 5 }`; `{ id: 5, … }` → `{ id: 5 }`; arrays element-wise. */
function associate(value: unknown, idField: string): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((element) => associate(element, idField)).filter((element) => element !== null);
  }
  if (typeof value === "object") {
    const id = (value as Record<string, unknown>)[idField];
    return id === undefined ? null : { [idField]: id };
  }
  return { [idField]: value };
}
