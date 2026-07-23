import type { OperationDescriptor, OperationRegistry } from "./operation-registry.js";
import type { OperationCardinality, OperationId, OperationKind, StandardOperationId } from "./operation.js";
import type { OperationHandler } from "./operation-handler.js";
import type { EntityConfig } from "../config/entity-config.js";
import { ConfigurationException } from "../errors/exceptions.js";

/** Map-backed operation registry (Phase 7), insertion-ordered. */
export class DefaultOperationRegistry<Entity = unknown> implements OperationRegistry<Entity> {
  private readonly entries = new Map<OperationId, OperationDescriptor<Entity>>();

  get(id: OperationId): OperationDescriptor<Entity> | undefined {
    return this.entries.get(id);
  }

  has(id: OperationId): boolean {
    return this.entries.has(id);
  }

  all(): readonly OperationDescriptor<Entity>[] {
    return [...this.entries.values()];
  }

  register(descriptor: OperationDescriptor<Entity>): void {
    this.entries.set(descriptor.id, descriptor);
  }

  replace(id: OperationId, handler: OperationHandler<Entity>): void {
    const existing = this.entries.get(id);
    if (existing === undefined) {
      throw new ConfigurationException(
        "unknown",
        `operations.${id}`,
        `cannot override '${id}': no such registered operation`,
      );
    }
    this.entries.set(id, { ...existing, handler });
  }

  disable(id: OperationId): void {
    const existing = this.entries.get(id);
    if (existing === undefined) {
      throw new ConfigurationException(
        "unknown",
        `operations.${id}`,
        `cannot disable '${id}': no such registered operation`,
      );
    }
    this.entries.set(id, { ...existing, enabled: false });
  }
}

interface StandardOperationShape {
  readonly kind: OperationKind;
  readonly cardinality: OperationCardinality;
  /** Enabled in the Milestone B skeleton; the rest activate in C. */
  readonly enabled: boolean;
}

/**
 * The standard operation table. The engine dispatches every operation
 * through the registry — these are just its default entries (ADR-0006),
 * and `@crudo/nest` route generation walks the same registry. Operations
 * whose behavior lands in Milestone C (`*Many`, restore, purge) are
 * registered **disabled**: calling one raises
 * `OperationDisabledException`, and no route is generated — a real seam,
 * not a TODO.
 */
export const STANDARD_OPERATIONS: Readonly<Record<StandardOperationId, StandardOperationShape>> = Object.freeze({
  createOne: { kind: "write", cardinality: "one", enabled: true },
  createMany: { kind: "write", cardinality: "many", enabled: false },
  findOne: { kind: "read", cardinality: "one", enabled: true },
  findMany: { kind: "read", cardinality: "many", enabled: true },
  updateOne: { kind: "write", cardinality: "one", enabled: true },
  updateMany: { kind: "write", cardinality: "many", enabled: false },
  patchOne: { kind: "write", cardinality: "one", enabled: true },
  patchMany: { kind: "write", cardinality: "many", enabled: false },
  deleteOne: { kind: "write", cardinality: "one", enabled: true },
  deleteMany: { kind: "write", cardinality: "many", enabled: false },
  restoreOne: { kind: "write", cardinality: "one", enabled: false },
  restoreMany: { kind: "write", cardinality: "many", enabled: false },
  purgeOne: { kind: "write", cardinality: "one", enabled: false },
});

/** Provides the handler for one standard operation id. */
export type StandardHandlerFactory<Entity> = (id: StandardOperationId) => OperationHandler<Entity>;

const unboundHandler = (id: OperationId): OperationHandler<unknown> => ({
  execute(): Promise<never> {
    throw new ConfigurationException(
      "unknown",
      `operations.${id}`,
      `operation '${id}' has no bound handler — this registry was built ` + `for inspection (route generation) only`,
    );
  },
});

/**
 * Build one entity's operation registry from its config (Phase 7; the
 * Phase 13 control surface configures exactly this):
 *
 * - standard entries first, honoring `operations.<id>: false` (disable)
 *   and `operations.<id>.handler` (override — default scaffolding stays);
 * - then `customOperations`, each with its own DTOs and `meta`.
 *
 * `handlers` binds the built-in behaviors; when omitted the entries carry
 * throwing placeholders — that mode exists for consumers that only need
 * the table (`@crudo/nest` route generation), never for execution.
 */
export function createOperationRegistry<Entity extends object>(
  config: EntityConfig<Entity> | undefined,
  handlers?: StandardHandlerFactory<Entity>,
): OperationRegistry<Entity> {
  const registry = new DefaultOperationRegistry<Entity>();
  const operations = config?.operations ?? {};

  for (const [id, shape] of Object.entries(STANDARD_OPERATIONS) as [StandardOperationId, StandardOperationShape][]) {
    const operationConfig = operations[id];
    const disabled = operationConfig === false;
    const override = operationConfig !== false ? operationConfig?.handler : undefined;
    registry.register({
      id,
      kind: shape.kind,
      cardinality: shape.cardinality,
      enabled: shape.enabled && !disabled,
      handler: override ?? handlers?.(id) ?? (unboundHandler(id) as unknown as OperationHandler<Entity>),
      input: null,
      output: null,
      meta: (operationConfig !== false ? operationConfig?.meta : undefined) ?? {},
    });
  }

  for (const [id, custom] of Object.entries(config?.customOperations ?? {})) {
    if (registry.has(id)) {
      throw new ConfigurationException(
        "unknown",
        `customOperations.${id}`,
        `'${id}' collides with a standard operation id`,
      );
    }
    registry.register({
      id,
      kind: "write",
      cardinality: "one",
      enabled: true,
      handler: custom.handler,
      input: custom.input ?? null,
      output: custom.output ?? null,
      meta: custom.meta ?? {},
    });
  }
  return registry;
}
