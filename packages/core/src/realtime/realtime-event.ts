import type { EntityId } from "../types/entity-id.js";

/**
 * Realtime event ids — the closed vocabulary a `RealtimeTransport` publishes
 * under. One per standard write outcome; `deleteOne` and `purgeOne` both map
 * to `"deleted"` (a subscriber only needs to know the row is gone, not which
 * delete strategy produced that). There is deliberately no id for a custom
 * operation — the vocabulary stays closed until a future issue decides what
 * a non-standard write publishes as.
 */
export type RealtimeEventId = "created" | "updated" | "patched" | "deleted" | "restored";

/**
 * The wire payload a `RealtimeTransport` publishes for one write. The
 * engine builds exactly one of these per emitted event and hands it to
 * every registered transport's `publish()` unchanged — a transport formats
 * it for its own wire (an SSE frame, a WebSocket message, …) but never
 * recomputes it.
 */
export interface RealtimeEventDto<ItemDto = unknown> {
  readonly event: RealtimeEventId;
  /** The entity's name, exactly as `EntityMetadata.name`/`config.entityName` report it. */
  readonly entity: string;
  readonly id: EntityId;
  /**
   * `<entity>.<id>` — the entity-level subscription channel a future
   * transport routes this event to. Field-level and collection channels
   * are not built yet (deferred, see the issue that added this seam).
   */
  readonly channel: string;
  /** ISO-8601, set once by the engine so every transport agrees on it. */
  readonly occurredAt: string;
  /**
   * The same output-DTO serialization already computed for the REST
   * response — no second serialization pass. `null` on `"deleted"`, where
   * there is nothing left to serialize.
   */
  readonly item: ItemDto | null;
  /**
   * `"updated"`/`"patched"` only — the field names present in the write
   * payload. This is "what the client asked to change," not a diff against
   * the row's previous value (which would need an extra read); documented
   * here so a consumer doesn't assume the stronger guarantee.
   */
  readonly changed?: readonly string[];
}
