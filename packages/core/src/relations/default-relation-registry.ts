import type { RelationDescriptor } from "./relation-descriptor.js";
import type { RelationRegistry } from "./relation-registry.js";

/**
 * Map-backed relation registry, populated from adapter metadata at
 * bootstrap. Milestone B only carries it (includes land in Phase 16), but
 * the registry existing now is what makes Phase 16 additive.
 */
export class DefaultRelationRegistry<Entity = unknown>
  implements RelationRegistry<Entity>
{
  private readonly relations: ReadonlyMap<string, RelationDescriptor>;

  constructor(descriptors: readonly RelationDescriptor[]) {
    this.relations = new Map(descriptors.map((d) => [d.name, d]));
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
