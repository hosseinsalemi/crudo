---
name: add-config-key
description: How to add a new key to KavoSettings — schema, default, merge semantics, validation, and docs — through the one layered precedence chain (global → entity → operation → per-call). Use when a change needs a new configurable behavior rather than a hardcoded constant.
---

# Adding a config key

Kavo has **one** configuration mechanism: `KavoSettings`, merged through a
single precedence chain (`packages/docs/architecture/08-configuration.md`):

```
built-in defaults → global (createKavo) → entity (createCrud)
                  → operation (operations.<id>) → per-call (CrudCallOptions)
```

The schema-extensibility rule (doc 08 §1) is normative: **feature work adds
keys to this schema — it never adds a second config mechanism.** If you find
yourself threading a new constructor parameter or a separate options object
through the engine, stop; it belongs in `KavoSettings`.

## Where the pieces live

1. **`BUILT_IN_DEFAULTS`** (`packages/core/src/config/defaults.ts`) — add the
   key with its default value. Every key needs one; there is no "unset" state
   a resolved config can observe.
2. **The settings type** — extend the `KavoSettings` interface/schema so the
   new key is typed at every scope (global defaults, entity config,
   `operations.<id>` overrides, `CrudCallOptions.settings`).
3. **`mergeSettings`** (`packages/core/src/config/merge-settings.ts`) — confirm
   the new key's shape matches the existing merge semantics rather than
   inventing a new one:
   - scalars and object-as-value keys: nearer scope replaces farther scope,
     key by key;
   - `false` disables an inheritable feature where the schema allows it
     (follow the `softDelete` / `operations.<id>` pattern) — a nearer object
     re-enables it;
   - arrays replace wholesale, never merge element-wise;
   - `undefined` at any scope is skipped, not treated as an explicit override.
4. **`validateSettings`** — add bootstrap validation that fails with a
   `ConfigurationException` naming **the entity, the key path, and the
   offending value** (doc 08 §4's message shape is the bar:
   `Invalid configuration for entity 'User' at 'pagination.maxLimit': ...`).
   Validation runs once at bootstrap (`resolveEntityConfig`), not per request
   — the resolved config is deep-frozen afterward, so this is the only chance
   to catch a bad value before it's baked in.
5. **`describeResolvedConfig`** — check whether the new key should surface in
   `kavo.describe(entityName)`'s debug dump; most settings keys should.

## Naming

Config keys are camelCase, and booleans are phrased positively —
`exposeInternals`, never `hideInternals` (CLAUDE.md Conventions). A boolean
key that reads as a double negative when combined with `false`-to-disable
semantics is a naming bug, not just a style nit.

## Tests

Per the `write-tests` skill, at minimum:

- the new key's default value takes effect with nothing overriding it;
- each scope in the precedence chain actually overrides the one before it
  (a test that only checks global-vs-default misses entity/operation/
  per-call regressions);
- `false`-disables-then-nearer-re-enables, if the key supports that;
- bootstrap validation rejects an invalid value with `ConfigurationException`
  and the right code, naming the entity and key path;
- if the key is per-call (`CrudCallOptions.settings`), that it's merged as a
  parameter for that request only and never mutates the frozen resolved
  config for subsequent calls.

Finish with `pnpm check`.

## Docs

Update `packages/docs/architecture/08-configuration.md`'s key table (§1) —
it's the single source of truth for what's configurable, and a key missing
from it is invisible to the next reader. If the key represents a new
load-bearing precedent (not just a parameter on an existing mechanism),
see the `add-adr` skill.
