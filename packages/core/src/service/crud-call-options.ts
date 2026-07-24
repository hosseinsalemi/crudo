import type { CrudoSettings } from "../config/settings.js";
import type { DeepPartial } from "../types/utility.js";
import type { TransactionContext } from "../persistence/transaction-manager.js";

/**
 * Per-call scope — the last link of the precedence chain (Phase 8).
 * Overrides are parameters for this one call; configuration is immutable
 * after bootstrap and there is no runtime mutation API.
 */
export interface CrudCallOptions {
  /** Join an existing transaction (the explicit `{ ctx }` parameter). */
  readonly transaction?: TransactionContext;
  /** Caller identity to expose on `CrudContext.principal`. */
  readonly principal?: unknown;
  /** Per-call settings overrides (e.g. a one-off `pagination.count`). */
  readonly settings?: DeepPartial<CrudoSettings>;
}
