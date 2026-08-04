import type { KavoSettings } from "../config/settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { RequestPreconditions } from "../caching/etag.js";
import type { TransactionContext } from "../persistence/transaction-manager.js";

/**
 * Per-call scope — the last link of the precedence chain.
 * Overrides are parameters for this one call; configuration is immutable
 * after bootstrap and there is no runtime mutation API.
 */
export interface KavoCallOptions {
  /** Join an existing transaction (the explicit `{ ctx }` parameter). */
  readonly transaction?: TransactionContext;
  /** Caller identity to expose on `KavoContext.principal`. */
  readonly principal?: unknown;
  /** Per-call settings overrides (e.g. a one-off `pagination.count`). */
  readonly settings?: DeepPartial<KavoSettings>;
  /**
   * Conditional-request tokens for this call — how the typed service
   * surface (`service.updateOne(id, data, { preconditions })`) reaches
   * `KavoRequest.preconditions` without every method growing a parameter
   * for it. `KavoRequest.preconditions`, when set, wins.
   */
  readonly preconditions?: RequestPreconditions;
}
