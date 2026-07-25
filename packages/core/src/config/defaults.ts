import type { CrudoSettings } from "./settings.js";

/**
 * The built-in defaults — the base of the precedence chain
 * `built-in defaults → global → entity → operation → per-call` (Phase 8).
 * The zero-config `createCrud(Entity)` path runs on exactly these values.
 */
export const BUILT_IN_DEFAULTS: CrudoSettings = Object.freeze({
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
});
