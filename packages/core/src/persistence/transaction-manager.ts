/**
 * Transaction propagation modes:
 * - `required`    — join the ambient transaction, else start one (default).
 * - `requiresNew` — always start a new transaction.
 * - `never`       — fail if a transaction is active.
 */
export type TransactionPropagation = "required" | "requiresNew" | "never";

/**
 * Handle to an active transaction, passed explicitly (`{ ctx }`) between
 * service calls that must share it. Explicit passing is the primary API —
 * visible, typed, testable; AsyncLocalStorage ambience is an optional
 * framework-layer convenience, never the core mechanism.
 */
export interface TransactionContext {
  readonly id: string;
  /**
   * The adapter's native transaction object (a TypeORM `QueryRunner` in
   * `@crudo/typeorm`) — opaque to core, meaningful only to the adapter
   * that created it.
   */
  readonly handle: unknown;
}

export interface TransactionOptions {
  readonly propagation?: TransactionPropagation;
}

/**
 * Runs work inside a transaction (implemented by adapters).
 * Commit on resolve, rollback on reject — no partial outcomes.
 */
export interface TransactionManager {
  run<Result>(
    work: (transaction: TransactionContext) => Promise<Result>,
    options?: TransactionOptions,
  ): Promise<Result>;
}
