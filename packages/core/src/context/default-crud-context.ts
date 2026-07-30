import type { CrudContext, CrudContextState, StateKey } from "./crud-context.js";
import type { NormalizedQueryContext } from "../query/query-context.js";
import type { OperationId } from "../operations/operation.js";
import type { ResolvedEntityConfig } from "../config/resolved-entity-config.js";
import type { TransactionContext } from "../persistence/transaction-manager.js";

/** Map-backed implementation of the typed per-request state bag. */
export class DefaultCrudContextState implements CrudContextState {
  private readonly values = new Map<symbol, unknown>();

  get<T>(key: StateKey<T>): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: StateKey<T>, value: T): void {
    this.values.set(key, value);
  }

  has(key: StateKey<unknown>): boolean {
    return this.values.has(key);
  }
}

/**
 * Web Crypto is a runtime global on every supported platform (Node ≥ 20,
 * browsers), but `@kavo/core` compiles against pure ES lib types with
 * zero imports (ADR-0005) — hence the typed accessor instead of a
 * `node:crypto` import.
 */
export function randomUuid(): string {
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}

export interface CrudContextInit<Entity> {
  readonly operation: OperationId;
  readonly config: ResolvedEntityConfig<Entity>;
  readonly principal?: unknown;
  readonly transaction?: TransactionContext | null;
  readonly query?: NormalizedQueryContext<Entity> | null;
  readonly correlationId?: string;
}

/**
 * Build the per-request context. The correlation id is generated
 * here when the caller (e.g. a framework layer forwarding an upstream
 * request id) doesn't supply one.
 */
export function createCrudContext<Entity>(init: CrudContextInit<Entity>): CrudContext<Entity> {
  return {
    entityName: init.config.entityName,
    operation: init.operation,
    config: init.config,
    principal: init.principal ?? null,
    transaction: init.transaction ?? null,
    query: init.query ?? null,
    correlationId: init.correlationId ?? randomUuid(),
    state: new DefaultCrudContextState(),
  };
}
