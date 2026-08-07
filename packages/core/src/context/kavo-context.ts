import type { OperationId } from "../operations/operation.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { NormalizedQueryContext } from "../query/query-context.js";
import type { TransactionContext } from "../persistence/transaction-manager.js";

/**
 * A typed key into the per-request state bag. The phantom type parameter
 * ties `set`/`get` to the same value type without casts:
 *
 * ```ts
 * const AuditStart = Symbol("auditStart") as StateKey<Date>;
 * context.state.set(AuditStart, new Date());
 * const started = context.state.get(AuditStart); // Date | undefined
 * ```
 */
export type StateKey<T> = symbol & { readonly __stateType?: T };

/** Typed per-request state bag for custom handlers to pass data. */
export interface KavoContextState {
  get<T>(key: StateKey<T>): T | undefined;
  set<T>(key: StateKey<T>, value: T): void;
  has(key: StateKey<unknown>): boolean;
}

/**
 * The per-request context threaded through the whole pipeline —
 * one object carrying identity, resolved config, and request-scoped state.
 */
export interface KavoContext<Entity = unknown> {
  readonly entityName: string;
  readonly operation: OperationId;
  readonly config: ResolvedEntityConfig<Entity>;
  /**
   * The authenticated caller — opaque to core, and available to custom
   * operation handlers and computed-field resolvers. Core never inspects
   * it and never populates it: it is whatever the caller put in
   * `KavoCallOptions.principal`, and `null` when nothing did.
   *
   * A programmatic caller passes it per call
   * (`crud.findOne(id, query, { principal })`). Over HTTP it is the
   * framework layer's job, and `@kavo/nest` does it only when the app has
   * said where the caller lives — `KavoModule.forRoot({ principal: true })`
   * for `request.user`, or an extractor function for anything else.
   * Without that option a generated route sends no options at all and this
   * stays `null`.
   */
  readonly principal: unknown;
  /** Active transaction, if any; `null` outside transactions. */
  readonly transaction: TransactionContext | null;
  /** Parsed, validated query — read operations only; `null` for writes. */
  readonly query: NormalizedQueryContext<Entity> | null;
  readonly correlationId: string;
  readonly state: KavoContextState;
}
