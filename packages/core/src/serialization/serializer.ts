import type { DtoClass } from "../dto/dto.js";
import type { CrudContext } from "../context/crud-context.js";

/**
 * Maps persistence-layer entities to response DTOs. Order is normative
 * (Phase 4): DTO mapping first, then field selection — the serializer
 * applies the selection carried on `context.query`.
 */
export interface Serializer<Entity = unknown> {
  serializeItem<ItemDto>(entity: Entity, dto: DtoClass<ItemDto & object> | null, context: CrudContext<Entity>): ItemDto;
  serializeList<ListDto>(
    entities: readonly Entity[],
    dto: DtoClass<ListDto & object> | null,
    context: CrudContext<Entity>,
  ): readonly ListDto[];
}

/**
 * Maps raw wire input (a request body) into the operation's input DTO
 * shape. `dto: null` means the entity-derived default shape applies. No
 * validation happens here — v6 has no validation subsystem; deserialize
 * shapes, it doesn't judge.
 */
export interface Deserializer<Entity = unknown> {
  deserialize<Shape>(raw: unknown, dto: DtoClass<Shape & object> | null, context: CrudContext<Entity>): Shape;
}
