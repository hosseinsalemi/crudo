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
  /** Whether the operation is on unless config says otherwise. */
  readonly enabled: boolean;
  /**
   * Operates on soft-deleted rows (Phase 14), so it only makes sense on a
   * soft-deletable entity. `restoreOne` switches on when the config
   * declares soft delete; `purgeOne` stays off until asked for by name.
   */
  readonly requiresSoftDelete?: boolean;
}

/**
 * The standard operation table. The engine dispatches every operation
 * through the registry — these are just its default entries (ADR-0006),
 * and `@kavo/nest` route generation walks the same registry.
 *
 * `enabled` here is the *unconditional* default;
 * `restoreOne`/`purgeOne` layer the Phase 14 soft-delete rule on top (see
 * {@link createOperationRegistry}).
 */
export const STANDARD_OPERATIONS: Readonly<Record<StandardOperationId, StandardOperationShape>> = Object.freeze({
  createOne: { kind: "write", cardinality: "one", enabled: true },
  findOne: { kind: "read", cardinality: "one", enabled: true },
  findMany: { kind: "read", cardinality: "many", enabled: true },
  updateOne: { kind: "write", cardinality: "one", enabled: true },
  patchOne: { kind: "write", cardinality: "one", enabled: true },
  deleteOne: { kind: "write", cardinality: "one", enabled: true },
  restoreOne: { kind: "write", cardinality: "one", enabled: false, requiresSoftDelete: true },
  purgeOne: { kind: "write", cardinality: "one", enabled: false, requiresSoftDelete: true },
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
 * - standard entries first, honoring `operations.<id>: false` (disable),
 *   `operations.<id>: true` / `{ enabled: true }` (enable), and
 *   `operations.<id>.handler` (override — default scaffolding stays);
 * - then `customOperations`, each with its own DTOs and `meta`.
 *
 * Phase 14's soft-delete operations default from the config alone, never
 * from ORM metadata: `restoreOne` turns on when the entity config
 * declares soft delete (`softDelete.strategy: "soft"` or an explicit
 * `softDelete.field`), `purgeOne` only when named outright. Route
 * generation runs at decoration time, where no ORM metadata exists
 * (ADR-0012), so both registry builds — engine and `@kavo/nest` — must
 * reach the same answer from the same input (ADR-0013). Enabling either
 * on an entity that does not resolve to a soft delete strategy is a
 * bootstrap error, raised in `createCrud` where metadata is known.
 *
 * `handlers` binds the built-in behaviors; when omitted the entries carry
 * throwing placeholders — that mode exists for consumers that only need
 * the table (`@kavo/nest` route generation), never for execution.
 */
export function createOperationRegistry<Entity extends object>(
  config: EntityConfig<Entity> | undefined,
  handlers?: StandardHandlerFactory<Entity>,
): OperationRegistry<Entity> {
  const registry = new DefaultOperationRegistry<Entity>();
  const operations = config?.operations ?? {};
  const softDeleteDeclared = declaresSoftDelete(config);

  for (const [id, shape] of Object.entries(STANDARD_OPERATIONS) as [StandardOperationId, StandardOperationShape][]) {
    const operationConfig = operations[id];
    const settings = typeof operationConfig === "object" ? operationConfig : undefined;
    const byDefault = shape.enabled || (id === "restoreOne" && softDeleteDeclared);
    registry.register({
      id,
      kind: shape.kind,
      cardinality: shape.cardinality,
      enabled: typeof operationConfig === "boolean" ? operationConfig : (settings?.enabled ?? byDefault),
      handler: settings?.handler ?? handlers?.(id) ?? (unboundHandler(id) as unknown as OperationHandler<Entity>),
      input: null,
      output: null,
      meta: settings?.meta ?? {},
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

/**
 * Whether an entity config *declares* soft delete — the config-only signal
 * `restoreOne` defaults from. Declaring means saying so on this entity:
 * `strategy: "soft"`, or naming the marker field explicitly. Merely
 * inheriting the built-in `strategy: "auto"` is not a declaration: `auto`
 * is answered by ORM metadata, which decoration time cannot see.
 */
function declaresSoftDelete(config: { readonly softDelete?: unknown } | undefined): boolean {
  const softDelete = config?.softDelete;
  if (typeof softDelete !== "object" || softDelete === null) return false;
  const { strategy, field } = softDelete as { strategy?: string; field?: string };
  return strategy === "soft" || typeof field === "string";
}
