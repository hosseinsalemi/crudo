import type { OperationId } from "@kavo/core";
import { CRUD_OVERRIDE_METADATA } from "./tokens.js";

/** What `@Override` records per decorated method, read back by `@Crud`. */
export interface OverrideMetadata {
  readonly operationId: OperationId;
}

/**
 * Marks a hand-written controller method as an operation's implementation
 * while `@Crud` still generates that operation's route from the registry —
 * method, path, status, `@Param`/`@Query`/`@Body`, and Swagger metadata, all
 * identical to what a generated route would carry. `operationId` defaults to
 * the decorated method's own name, the same inference manual-method-wins
 * already uses; pass it explicitly when the method name differs.
 *
 * The decorated method must accept parameters in the same fixed position
 * `@Crud` would apply to a generated route — reads: `(id?, query)`; writes:
 * `(id?, body)` — undecorated, since Kavo supplies those decorators itself.
 * Adding your own `@Param`/`@Query`/`@Body` on an overridden method is a
 * decoration-time error (duplicate route-argument metadata).
 *
 * Distinct from plain manual-method-wins: an undecorated method whose name
 * matches an operation id suppresses that route entirely — no method/path/
 * status/Swagger wiring happens for it. `@Override` keeps all of that,
 * swapping only which function backs the route.
 */
export function Override(operationId?: OperationId): MethodDecorator {
  return (target, propertyKey) => {
    const id = operationId ?? (propertyKey as OperationId);
    Reflect.defineMetadata(CRUD_OVERRIDE_METADATA, { operationId: id } satisfies OverrideMetadata, target, propertyKey);
  };
}
