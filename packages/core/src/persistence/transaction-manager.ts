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
 *
 * @remarks
 * Intentionally unimplemented, not dead. v6 has no standalone transaction
 * phase (see "Transactions, scoped down" under Phase 9/10 in
 * `crudo-phases-v6.md`): the only consumer of multi-write atomicity is bulk
 * `atomic` mode, which Phase 14 declares optional and this build dropped.
 * The binder, when bulk is built, is the adapter-level `runInTransaction`
 * hook — this interface (with `TransactionOptions` / `TransactionPropagation`)
 * is the Phase 3 contract it would be expressed through, kept because Phase 3
 * fixes the type system once and later phases never mutate core's types.
 * `TransactionContext` is already live: it is threaded through `CrudContext`
 * and `CrudCallOptions` as an opaque adapter handle.
 */
export interface TransactionManager {
  run<Result>(
    work: (transaction: TransactionContext) => Promise<Result>,
    options?: TransactionOptions,
  ): Promise<Result>;
}
