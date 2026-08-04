import type { KavoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { EntityConfig, OperationConfig, QueryFieldSelector } from "./entity-config.js";
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
import { ConfigurationException } from "../errors/exceptions.js";

/**
 * Top-level settings keys — the subset of an `EntityConfig` that merges.
 * `operations` is deliberately excluded: `EntityConfig.operations` is a
 * structurally different (richer, per-entity-typed) shape than
 * `KavoSettings.operations`'s global boolean map, so picking it here would
 * feed entity-scope `handler`/`meta` entries through the boolean-shaped
 * merge. `createOperationRegistry` resolves entity/operation-scope
 * `operations` directly from `EntityConfig`; the global boolean default
 * still reaches `entitySettings.operations` for free below, via
 * `mergeSettings(BUILT_IN_DEFAULTS, globalDefaults, …)` — `globalDefaults`
 * is a `KavoSettings`-shaped `DeepPartial`, so its `operations` key merges
 * normally even though `pickSettings` never reads it off `entityConfig`.
 */
const SETTINGS_KEYS = [
  "pagination",
  "query",
  "errors",
  "relations",
  "caching",
  "softDelete",
] as const satisfies readonly (keyof KavoSettings)[];

/**
 * An `EntityConfig`/`OperationConfig` mixes settings keys with structural
 * keys (`dto`, `allowlists`, `handler`, …); only the settings subset
 * participates in the merge algebra.
 */
function pickSettings(config: Readonly<Record<string, unknown>> | undefined): DeepPartial<KavoSettings> | undefined {
  if (config === undefined) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    if (config[key] !== undefined) picked[key] = config[key];
  }
  return picked as DeepPartial<KavoSettings>;
}

/**
 * Merge and validate one entity's configuration, once, at bootstrap:
 * `built-in defaults → global → entity → operation`. The result
 * is deep-frozen; per-call overrides are parameters (`KavoCallOptions`),
 * never writes into this object.
 */
export function resolveEntityConfig<Entity extends object>(
  metadata: EntityMetadata<Entity>,
  entityConfig: EntityConfig<Entity> | undefined,
  globalDefaults: DeepPartial<KavoSettings> | undefined,
): ResolvedEntityConfig<Entity> {
  const entityName = metadata.name;
  const allowlists = resolveAllowlists(metadata, entityConfig);
  const entitySettings = mergeSettings(
    BUILT_IN_DEFAULTS,
    globalDefaults,
    pickSettings(entityConfig as Readonly<Record<string, unknown>> | undefined),
  );
  validateSettings(entityName, entitySettings);
  validateDefaultSort(entityName, entitySettings, allowlists);

  // Per-operation settings views, precomputed for every operation that
  // declares overrides. `false` (disabled) contributes no settings — the
  // registry handles disabling.
  const perOperation = new Map<OperationId, KavoSettings>();
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
    validateDefaultSort(scope, merged, allowlists);
    // Resolve for its validation side effect: a per-operation scope that
    // demands soft delete on an entity without a marker field must fail at
    // bootstrap, not on the first request (the engine recomputes the
    // strategy for whichever settings view a call ends up with).
    resolveSoftDelete(metadata, merged, scope);
    perOperation.set(operation, deepFreeze(merged));
  }

  const resolved: ResolvedEntityConfig<Entity> = {
    entityName,
    settings: deepFreeze(entitySettings),
    settingsFor(operation: OperationId): KavoSettings {
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
 * Allowlist derivation (security posture): when a list is not
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
    filterable: resolveFieldSelector(ownColumns, configured?.filterable),
    sortable: resolveFieldSelector(ownColumns, configured?.sortable),
    selectable: resolveFieldSelector(ownColumns, configured?.selectable),
  });
}

/**
 * `query.defaultSort` fields are checked against the same sortable
 * allowlist client-supplied `sort` fields are checked against at request
 * time — but here, at bootstrap, so a misconfigured default fails fast
 * instead of surfacing as a broken `ORDER BY` on the first request.
 */
export function validateDefaultSort<Entity>(
  scope: string,
  settings: KavoSettings,
  allowlists: ResolvedQueryAllowlists<Entity>,
): void {
  const sortable = allowlists.sortable as readonly string[];
  for (const entry of settings.query.defaultSort) {
    if (!sortable.includes(entry.field)) {
      throw new ConfigurationException(
        scope,
        "query.defaultSort",
        `field '${entry.field}' is not in the sortable allowlist`,
      );
    }
  }
}

/**
 * Resolves one allowlist key's raw selector against the entity's own
 * columns: an explicit array is used as-is; `{ exclude }` resolves to
 * `ownColumns` minus the named paths, so a column outside `ownColumns` can
 * never appear via `exclude` and stays fail-closed like the plain default.
 */
function resolveFieldSelector<Entity>(
  ownColumns: readonly FieldPath<Entity>[],
  selector: QueryFieldSelector<Entity> | undefined,
): readonly FieldPath<Entity>[] {
  if (selector === undefined) return ownColumns;
  if (!("exclude" in selector)) return selector;
  const excluded = new Set(selector.exclude);
  return ownColumns.filter((column) => !excluded.has(column));
}

/**
 * Debug dump: the resolved configuration for one
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
