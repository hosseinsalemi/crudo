import type { CrudContext } from "../context/crud-context.js";
import type { DtoClass } from "../dto/dto.js";
import type { Deserializer, Serializer } from "./serializer.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import { dtoShapeKeys } from "../dto/dto-shape.js";

/**
 * Default response mapping (Phase 4). Serialization order is normative:
 * **DTO mapping first, then field selection** — selection can only narrow
 * what the resolved DTO exposes.
 *
 * Projection sources, in order:
 * 1. An explicit DTO class with initialized fields → its key set.
 * 2. Otherwise the entity-derived default: every scalar column from
 *    adapter metadata (relations are excluded until Phase 16 includes
 *    them deliberately).
 */
export class DefaultSerializer<Entity = unknown> implements Serializer<Entity> {
  private readonly defaultProjection: readonly string[];

  constructor(metadata: EntityMetadata<Entity>) {
    this.defaultProjection = metadata.fields.map((field) => field.name);
  }

  serializeItem<ItemDto>(
    entity: Entity,
    dto: DtoClass<ItemDto & object> | null,
    context: CrudContext<Entity>,
  ): ItemDto {
    const projection = dtoShapeKeys(dto) ?? this.defaultProjection;
    const selection = context.query?.fields.root;
    const keys =
      selection == null
        ? projection
        : projection.filter((key) =>
            (selection as readonly string[]).includes(key),
          );
    const source = entity as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in source) result[key] = source[key];
    }
    return result as ItemDto;
  }

  serializeList<ListDto>(
    entities: readonly Entity[],
    dto: DtoClass<ListDto & object> | null,
    context: CrudContext<Entity>,
  ): readonly ListDto[] {
    return entities.map((entity) => this.serializeItem(entity, dto, context));
  }
}

/**
 * Default request-body mapping (Phase 4). Picks the keys the operation's
 * input shape allows and silently drops everything else — with no
 * validation subsystem in v6, stripping unknown and non-writable keys
 * (generated columns, relation properties) is the safe default: a client
 * cannot write `id` or `createdAt` by including them in a body.
 */
export class DefaultDeserializer<Entity = unknown>
  implements Deserializer<Entity>
{
  private readonly writableProjection: readonly string[];

  constructor(metadata: EntityMetadata<Entity>) {
    this.writableProjection = metadata.fields
      .filter((field) => !field.generated)
      .map((field) => field.name);
  }

  deserialize<Shape>(
    raw: unknown,
    dto: DtoClass<Shape & object> | null,
    _context: CrudContext<Entity>,
  ): Shape {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return {} as Shape;
    }
    const allowed = dtoShapeKeys(dto) ?? this.writableProjection;
    const source = raw as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in source) result[key] = source[key];
    }
    return result as Shape;
  }
}
