import type { CrudoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { EntityConfig, OperationConfig } from "./entity-config.js";
import type { ResolvedEntityConfig, ResolvedQueryAllowlists } from "./resolved-entity-config.js";
import type { EntityMetadata } from "../metadata/entity-metadata.js";
import type { FieldPath } from "../types/field-path.js";
import type { OperationId, StandardOperationId } from "../operations/operation.js";
import { BUILT_IN_DEFAULTS } from "./defaults.js";
import { deepFreeze, mergeSettings } from "./merge-settings.js";
import { validateSettings } from "./validate-settings.js";
import { DefaultDtoResolver } from "../dto/default-dto-resolver.js";
import { DefaultRelationRegistry } from "../relations/default-relation-registry.js";
import { resolveSoftDelete } from "../persistence/soft-delete.js";

/** Top-level settings keys — the subset of an `EntityConfig` that merges. */
const SETTINGS_KEYS = [
  "pagination",
  "query",
  "errors",
  "relations",
  "softDelete",
] as const satisfies readonly (keyof CrudoSettings)[];

/**
 * An `EntityConfig`/`OperationConfig` mixes settings keys with structural
 * keys (`dto`, `allowlists`, `handler`, …); only the settings subset
 * participates in the merge algebra.
 */
function pickSettings(config: Readonly<Record<string, unknown>> | undefined): DeepPartial<CrudoSettings> | undefined {
  if (config === undefined) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    if (config[key] !== undefined) picked[key] = config[key];
  }
  return picked as DeepPartial<CrudoSettings>;
}

/**
 * Merge and validate one entity's configuration, once, at bootstrap
 * (Phase 8): `built-in defaults → global → entity → operation`. The result
 * is deep-frozen; per-call overrides are parameters (`CrudCallOptions`),
 * never writes into this object.
 */
export function resolveEntityConfig<Entity extends object>(
  metadata: EntityMetadata<Entity>,
  entityConfig: EntityConfig<Entity> | undefined,
  globalDefaults: DeepPartial<CrudoSettings> | undefined,
): ResolvedEntityConfig<Entity> {
  const entityName = metadata.name;
  const entitySettings = mergeSettings(
    BUILT_IN_DEFAULTS,
    globalDefaults,
    pickSettings(entityConfig as Readonly<Record<string, unknown>> | undefined),
  );
  validateSettings(entityName, entitySettings);

  // Per-operation settings views, precomputed for every operation that
  // declares overrides. `false` (disabled) contributes no settings — the
  // registry handles disabling.
  const perOperation = new Map<OperationId, CrudoSettings>();
  for (const [operation, config] of Object.entries(entityConfig?.operations ?? {}) as [
    StandardOperationId,
    OperationConfig<Entity> | boolean,
  ][]) {
    // Boolean shorthands carry no settings — enablement is the registry's.
    if (typeof config === "boolean") continue;
    const settings = pickSettings(config as Readonly<Record<string, unknown>>);
    if (settings === undefined || Object.keys(settings).length === 0) continue;
    const merged = mergeSettings(entitySettings, settings);
    const scope = `${entityName}.operations.${operation}`;
    validateSettings(scope, merged);
    // Resolve for its validation side effect: a per-operation scope that
    // demands soft delete on an entity without a marker field must fail at
    // bootstrap, not on the first request (the engine recomputes the
    // strategy for whichever settings view a call ends up with).
    resolveSoftDelete(metadata, merged, scope);
    perOperation.set(operation, deepFreeze(merged));
  }

  const allowlists = resolveAllowlists(metadata, entityConfig);

  const resolved: ResolvedEntityConfig<Entity> = {
    entityName,
    settings: deepFreeze(entitySettings),
    settingsFor(operation: OperationId): CrudoSettings {
      return perOperation.get(operation) ?? entitySettings;
    },
    allowlists,
    softDelete: resolveSoftDelete(metadata, entitySettings),
    dto: new DefaultDtoResolver<Entity>(entityConfig?.dto),
    relations: new DefaultRelationRegistry<Entity>(metadata.relations, entitySettings.relations.edges, entityName),
  };
  return Object.freeze(resolved);
}

/**
 * Allowlist derivation (Phase 5 security posture): when a list is not
 * configured explicitly, it defaults to the entity's **own scalar
 * columns** — relation paths are never filterable/sortable/selectable
 * unless opted in explicitly. Anything outside the list is a 400 at query
 * time, never a silent drop.
 */
function resolveAllowlists<Entity extends object>(
  metadata: EntityMetadata<Entity>,
  entityConfig: EntityConfig<Entity> | undefined,
): ResolvedQueryAllowlists<Entity> {
  const ownColumns = metadata.fields.map((field) => field.name) as unknown as readonly FieldPath<Entity>[];
  const configured = entityConfig?.allowlists;
  return deepFreeze({
    filterable: configured?.filterable ?? ownColumns,
    sortable: configured?.sortable ?? ownColumns,
    selectable: configured?.selectable ?? ownColumns,
  });
}

/**
 * Debug dump (Phase 8 deliverable): the resolved configuration for one
 * entity as a plain printable object — what you `console.log` when a
 * merge result surprises you.
 */
export function describeResolvedConfig<Entity>(
  config: ResolvedEntityConfig<Entity>,
  operations: readonly OperationId[] = [],
): Record<string, unknown> {
  return {
    entityName: config.entityName,
    settings: config.settings,
    allowlists: config.allowlists,
    softDelete: config.softDelete,
    relations: config.relations.all().map((relation) => ({
      name: relation.name,
      cardinality: relation.cardinality,
      includable: relation.includable,
      strategy: relation.strategy,
    })),
    operations: Object.fromEntries(operations.map((operation) => [operation, config.settingsFor(operation)])),
  };
}
