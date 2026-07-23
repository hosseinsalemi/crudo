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
  // Reserved keys — consumed by Phases 15/16, validated and merged now so
  // feature phases add behavior, never a second config mechanism.
  relations: Object.freeze({
    maxIncludeDepth: 2,
    maxIncludedNodes: 10,
  }),
  softDelete: Object.freeze({
    field: "deletedAt",
  }),
  bulk: Object.freeze({
    mode: "atomic" as const,
    maxBatchSize: 500,
  }),
});
