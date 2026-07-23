import type { OperationCardinality, OperationId, OperationKind } from "./operation.js";
import type { OperationHandler, OperationMetadata } from "./operation-handler.js";
import type { DtoClass } from "../dto/dto.js";

/** One registered operation: the unit the engine dispatches through. */
export interface OperationDescriptor<Entity = unknown, Input = unknown, Output = unknown> {
  readonly id: OperationId;
  readonly kind: OperationKind;
  readonly cardinality: OperationCardinality;
  /**
   * Disabled entries stay in the registry (so tooling can report them) but
   * never execute — calling one raises `OperationDisabledException`, and
   * `@crudo/nest` generates no route for it.
   */
  readonly enabled: boolean;
  readonly handler: OperationHandler<Entity, Input, Output>;
  /** Explicit input DTO; `null` = the Phase 4 slot default. */
  readonly input: DtoClass | null;
  /** Explicit output DTO; `null` = the Phase 4 slot default. */
  readonly output: DtoClass | null;
  readonly meta: OperationMetadata;
}

/**
 * The per-entity operation table (Phase 7). The engine dispatches *every*
 * operation through this registry — the built-in CRUD handlers are just
 * default entries, nothing about them is special-cased. Phase 14's
 * disable/override/custom config is a control surface over this registry,
 * and `@crudo/nest` route generation reads it — which is what makes later
 * operations appear as routes with zero changes to the generator.
 */
export interface OperationRegistry<Entity = unknown> {
  get(id: OperationId): OperationDescriptor<Entity> | undefined;
  has(id: OperationId): boolean;
  /** All entries, enabled and disabled, in registration order. */
  all(): readonly OperationDescriptor<Entity>[];
  register(descriptor: OperationDescriptor<Entity>): void;
  /** Replace an entry's handler, keeping its scaffolding (override). */
  replace(id: OperationId, handler: OperationHandler<Entity>): void;
  /** Deactivate an entry (disable). */
  disable(id: OperationId): void;
}
