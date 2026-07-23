import type {
  ClassRef,
  CrudInfrastructure,
  CrudoInstance,
  CrudoOptions,
  EntityMetadata,
  RepositoryAdapter,
} from "@crudo/core";
import { createCrudo } from "@crudo/core";
import type { DataSource, ObjectLiteral } from "typeorm";
import { buildEntityMetadata } from "./metadata.js";
import { TypeOrmRepositoryAdapter } from "./typeorm-repository-adapter.js";

/**
 * The TypeORM implementation of core's infrastructure seam: metadata and
 * adapters derived from one `DataSource`, cached per entity (metadata
 * derivation and adapter construction are bootstrap work, not
 * per-request work).
 */
export function createTypeOrmInfrastructure(dataSource: DataSource): CrudInfrastructure {
  const metadataCache = new Map<ClassRef, EntityMetadata>();
  const adapterCache = new Map<ClassRef, RepositoryAdapter>();

  return {
    metadataFor<Entity extends object>(entity: ClassRef<Entity>) {
      let metadata = metadataCache.get(entity);
      if (metadata === undefined) {
        metadata = buildEntityMetadata(dataSource, entity as ClassRef<ObjectLiteral>);
        metadataCache.set(entity, metadata);
      }
      return metadata as EntityMetadata<Entity>;
    },
    adapterFor<Entity extends object>(entity: ClassRef<Entity>) {
      let adapter = adapterCache.get(entity);
      if (adapter === undefined) {
        adapter = new TypeOrmRepositoryAdapter(dataSource, entity as ClassRef<ObjectLiteral>) as RepositoryAdapter;
        adapterCache.set(entity, adapter);
      }
      return adapter as RepositoryAdapter<Entity>;
    },
  };
}

/**
 * Sugar for the common case: a Crudo root instance wired to one TypeORM
 * `DataSource`, so `crudo.createCrud(UserEntity)` is genuinely
 * zero-config.
 */
export function createTypeOrmCrudo(
  dataSource: DataSource,
  options: Omit<CrudoOptions, "infrastructure"> = {},
): CrudoInstance {
  return createCrudo({
    ...options,
    infrastructure: createTypeOrmInfrastructure(dataSource),
  });
}
