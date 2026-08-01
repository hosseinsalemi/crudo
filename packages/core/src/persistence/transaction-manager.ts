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
   * `@kavo/typeorm`) — opaque to core, meaningful only to the adapter
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
 *
 * @remarks
 * Intentionally unimplemented, not dead — but read the caveat. Kavo has no
 * standalone cross-cutting transaction system: multi-write atomicity was
 * scoped down to a narrow adapter-level hook, and the only consumer it ever
 * had was the optional batch surface, which this build dropped outright —
 * its types are gone from core, not merely disabled. That leaves this
 * interface with **no** consumer in sight, which is a weaker justification
 * than it had before. It is kept because core's type system was fixed once
 * and is not meant to churn; if that stops being reason enough, deleting it
 * is the honest next step.
 * `TransactionContext` is already live: it is threaded through `KavoContext`
 * and `KavoCallOptions` as an opaque adapter handle.
 */
export interface TransactionManager {
  run<Result>(
    work: (transaction: TransactionContext) => Promise<Result>,
    options?: TransactionOptions,
  ): Promise<Result>;
}
