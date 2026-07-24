# 08 — Configuration System (Phase 8)

One layered model, one schema (`CrudoSettings`), one precedence chain:

```
built-in defaults → global (createCrudo) → entity (createCrud)
                  → operation (operations.<id>) → per-call (CrudCallOptions)
```

## 1. Schema and built-in defaults

`BUILT_IN_DEFAULTS` (`core/src/config/defaults.ts`):

| Key                                              | Default                  | Notes                                                                          |
| ------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| `pagination.defaultLimit` / `maxLimit`           | 20 / 100                 | `defaultLimit ≤ maxLimit` enforced                                             |
| `pagination.strategy`                            | `"offset"`               | `"page"` built in; custom via `paginationStrategies`                           |
| `pagination.count`                               | `true`                   | `false` skips the count query; envelope reports `total: null`                  |
| `query.maxFilterDepth` / `maxInValues`           | 3 / 100                  |                                                                                |
| `errors.exposeInternals`                         | `false`                  | leak driver detail into responses                                              |
| `relations.maxIncludeDepth` / `maxIncludedNodes` | 2 / 10                   | include depth budget and total node cap (Phase 15)                             |
| `relations.edges.<name>`                         | `{}`                     | per-relation `includable` / `defaultInclude` / `maxDepth` / `strategy`         |
| `softDelete.field` / `strategy`                  | `"deletedAt"` / `"auto"` | Phase 14; `auto` = soft when the entity has the marker field, `false` disables |
| `bulk.mode` / `maxBatchSize`                     | `"atomic"` / 500         | reserved (bulk is not built)                                                   |

**Schema extensibility rule:** feature phases add keys to this schema —
they never add a second config mechanism. The reserved keys above are
already merged and validated so a later feature adds behavior only.

## 2. Merge semantics (normative)

Implemented in `mergeSettings` (`merge-settings.ts`):

- Scalars and objects-as-values: nearer scope **replaces** farther scope,
  key by key — an override supplies only what it changes.
- `false` disables an inheritable feature where the schema allows it
  (`softDelete: false`, `operations.patchOne: false`); a nearer object
  re-enables.
- Arrays replace wholesale. `undefined` scopes are skipped.

An `EntityConfig` mixes settings keys with structural keys (`dto`,
`allowlists`, `operations`, `customOperations`); only the settings subset
participates in the merge.

## 3. Resolution timing and immutability

All merging happens **once at bootstrap** (`resolveEntityConfig`) into a
deep-frozen `ResolvedEntityConfig`: entity-scope settings, precomputed
per-operation views behind `settingsFor(operation)`, resolved allowlists
(explicit or derived from own scalar columns), the cached `DtoResolver`,
and the relation registry. There is no runtime mutation API — per-call
overrides (`CrudCallOptions.settings`) are merged as _parameters_ onto
the operation view inside the engine, validated, and discarded with the
request.

## 4. Bootstrap validation

`validateSettings` fails fast with a `ConfigurationException` naming the
**entity, the key path, and the offending value**
(`Invalid configuration for entity 'User' at 'pagination.maxLimit':
expected a positive integer, got -1`). The same bar applies to unknown
pagination strategies, missing infrastructure, non-`@Crud` controllers in
`forFeature`, and custom-operation id collisions.

## 5. Root factory and framework skin

`createCrudo({ defaults, infrastructure, paginationStrategies })` is the
core entry point; the bare `createCrud(Entity, config?, runtime)` is an
implicit root instance with built-in defaults — the zero-config path pays
nothing for any of this. `CrudoModule.forRoot` (doc 10) is a thin skin:
it passes `defaults` through untouched and contributes only its own
route concerns via the `OperationMetadata` augmentation (ADR-0007).

## 6. Debug dump

`crudo.describe(entityName)` (backed by `describeResolvedConfig`) returns
the frozen result for one entity — settings, allowlists, relations, and
every per-operation view — as a plain printable object.
