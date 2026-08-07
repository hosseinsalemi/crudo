import type { KavoSettings } from "./settings.js";
import type { ComputedFieldMap } from "./computed-field.js";
import type { FieldPath } from "../types/field-path.js";
import type { DtoResolver } from "../dto/dto.js";
import type { OperationId } from "../operations/operation.js";
import type { RelationRegistry } from "../relations/relation-registry.js";
import type { ResolvedSoftDelete } from "../persistence/soft-delete.js";
import type { RealtimeTransport } from "../realtime/realtime-transport.js";

/** Allowlists after bootstrap resolution — complete, never optional. */
export interface ResolvedQueryAllowlists<Entity = unknown> {
  readonly filterable: readonly FieldPath<Entity>[];
  readonly sortable: readonly FieldPath<Entity>[];
  readonly selectable: readonly FieldPath<Entity>[];
}

/**
 * The frozen, fully-merged configuration for one entity — the product of
 * the precedence chain `built-in defaults → global → entity → operation`
 * (per-call overrides are parameters, not config writes).
 *
 * All merging happens once at bootstrap; the result is immutable. Invalid
 * config fails fast at bootstrap with an error naming the entity, the key
 * path, and the offending value.
 */
export interface ResolvedEntityConfig<Entity = unknown> {
  readonly entityName: string;
  /** Entity-scope settings (global already merged in). */
  readonly settings: KavoSettings;
  /** Per-operation settings view: entity settings + operation overrides. */
  settingsFor(operation: OperationId): KavoSettings;
  readonly allowlists: ResolvedQueryAllowlists<Entity>;
  /**
   * The delete strategy resolved for this scope — `hard` with
   * a `null` field for everything that isn't soft-deletable, so adapters
   * branch on one object instead of re-deriving the decision.
   */
  readonly softDelete: ResolvedSoftDelete;
  /** Bootstrap-cached DTO resolution. */
  readonly dto: DtoResolver<Entity>;
  /**
   * Declared computed fields, validated at bootstrap — an empty record when
   * the entity declares none. Read by the serializer (to evaluate them) and
   * by the deserializer (to keep them out of writes), for this entity and,
   * through the catalog, for any relation target (ADR-0019).
   */
  readonly computed: ComputedFieldMap<Entity>;
  /** Relation edges of this entity. */
  readonly relations: RelationRegistry<Entity>;
  /**
   * Registered realtime transports — resolved once per `createKavo` root
   * (`KavoOptions.realtimeTransports`), not per entity and not through the
   * settings precedence chain: a transport is a live object, so only the
   * array container is frozen, never its elements (ADR-0023).
   */
  readonly realtimeTransports: readonly RealtimeTransport[];
}
