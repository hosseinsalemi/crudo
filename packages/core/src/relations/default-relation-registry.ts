import type { RelationDescriptor } from "./relation-descriptor.js";
import type { RelationRegistry } from "./relation-registry.js";
import type { RelationEdgeSettings } from "../config/settings.js";
import { ConfigurationException } from "../errors/exceptions.js";

/**
 * Map-backed relation registry, built once at bootstrap from two sources
 * (Phase 15): the adapter's ORM metadata supplies *shape* — name, target,
 * cardinality — and `relations.edges` config supplies *permission*, which
 * metadata can never know. Inclusion is opt-in, so a relation with no
 * config entry stays `includable: false`.
 */
export class DefaultRelationRegistry<Entity = unknown> implements RelationRegistry<Entity> {
  private readonly relations: ReadonlyMap<string, RelationDescriptor>;

  constructor(
    descriptors: readonly RelationDescriptor[],
    edges: Readonly<Record<string, RelationEdgeSettings>> = {},
    entityName = "entity",
  ) {
    const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
    for (const [name, edge] of Object.entries(edges)) {
      const descriptor = byName.get(name);
      if (descriptor === undefined) {
        // Fail fast: a typo in an allowlist that permits nothing looks
        // exactly like working config until the first client asks.
        throw new ConfigurationException(
          entityName,
          `relations.edges.${name}`,
          `'${name}' is not a relation of ${entityName} (relations: ${[...byName.keys()].join(", ") || "none"})`,
        );
      }
      byName.set(name, {
        ...descriptor,
        // Naming the relation in `edges` is itself the opt-in; spelling
        // `includable: false` keeps the other keys usable while closed.
        includable: edge.includable ?? true,
        ...(edge.defaultInclude !== undefined && { defaultInclude: edge.defaultInclude }),
        ...(edge.maxDepth !== undefined && { maxDepth: edge.maxDepth }),
        strategy: edge.strategy ?? descriptor.strategy,
      });
    }
    this.relations = byName;
  }

  get(name: string): RelationDescriptor | undefined {
    return this.relations.get(name);
  }

  has(name: string): boolean {
    return this.relations.has(name);
  }

  all(): readonly RelationDescriptor[] {
    return [...this.relations.values()];
  }
}
