import type { KavoSettings } from "./settings.js";

/**
 * The built-in defaults — the base of the precedence chain
 * `built-in defaults → global → entity → operation → per-call` (Phase 8).
 * The zero-config `createCrud(Entity)` path runs on exactly these values.
 */
export const BUILT_IN_DEFAULTS: KavoSettings = Object.freeze({
  pagination: Object.freeze({
    defaultLimit: 20,
    maxLimit: 100,
    strategy: "offset",
    count: true,
  }),
  query: Object.freeze({
    maxFilterDepth: 3,
    maxInValues: 100,
  }),
  errors: Object.freeze({
    exposeInternals: false,
  }),
  relations: Object.freeze({
    maxIncludeDepth: 2,
    maxIncludedNodes: 10,
    // Inclusion is opt-in: with no edges configured, `include=` has
    // nothing to reach (Phase 15).
    edges: Object.freeze({}),
  }),
  // `auto`: soft for entities carrying the marker field, hard for the rest
  // (Phase 14) — nothing to configure for entities that aren't
  // soft-deletable.
  softDelete: Object.freeze({
    field: "deletedAt",
    strategy: "auto" as const,
  }),
  // Unset: today's `STANDARD_OPERATIONS` enabled-by-default behavior (and
  // ADR-0013's soft-delete-driven `restoreOne` auto-enable) is unchanged
  // for apps that don't set a global default.
  operations: Object.freeze({}),
});
