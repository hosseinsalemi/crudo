import type { DtoClass, DtoResolver, DtoSlot, OperationDtoMap } from "./dto.js";
import type { OperationId } from "../operations/operation.js";

/**
 * Bootstrap-cached DTO resolution (Phase 4). Each slot resolves
 * independently: the explicitly registered class, or `null` meaning "use
 * the entity-derived default" (derivation is metadata-driven and happens
 * in the serializer/deserializer, which can see `EntityMetadata`).
 *
 * Fallback chain baked in at construction:
 * - `patch` falls back to the registered `update` class (its key set is
 *   the derivation source for `Partial<update>`), else `null`.
 * - `list` falls back to the registered `item` class ("same as `item`'s
 *   resolved type"), else `null`.
 *
 * Restore (Phase 14) and custom operations (Phase 13) reuse `item`/`list`;
 * the `operation` argument exists so a later phase *could* specialize per
 * operation, but v6 resolution is slot-driven only.
 */
export class DefaultDtoResolver<Entity = unknown> implements DtoResolver<Entity> {
  private readonly slots: Readonly<Record<DtoSlot, DtoClass | null>>;

  constructor(dto: OperationDtoMap<Entity> = {}) {
    const map = dto as Record<DtoSlot, DtoClass | undefined>;
    this.slots = Object.freeze({
      create: map.create ?? null,
      update: map.update ?? null,
      patch: map.patch ?? map.update ?? null,
      query: map.query ?? null,
      item: map.item ?? null,
      list: map.list ?? map.item ?? null,
    });
  }

  resolve(slot: DtoSlot, _operation: OperationId): DtoClass | null {
    return this.slots[slot];
  }
}
