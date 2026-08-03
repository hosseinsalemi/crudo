import type {
  ClassRef,
  EntityMetadata,
  KavoInfrastructure,
  KavoInstance,
  KavoOptions,
  RepositoryAdapter,
} from "@kavo/core";
import { createKavo } from "@kavo/core";
import type { MikroORM } from "@mikro-orm/core";
import { buildEntityMetadata } from "./metadata.js";
import { MikroOrmRepositoryAdapter } from "./mikro-orm-repository-adapter.js";

/**
 * What MikroORM needs beyond the ORM instance. Nothing is required — a
 * MikroORM entity is a real runtime class carrying its own metadata, so the
 * ORM instance alone supplies both halves of core's infrastructure seam,
 * exactly as a TypeORM `DataSource` does and unlike `@kavo/prisma`, which
 * needs caller-declared marker classes (ADR-0017).
 */
export interface MikroOrmInfrastructureOptions {
  /**
   * Whether the driver supports MikroORM's `$ilike` operator — PostgreSQL
   * does; SQLite, MySQL, and MongoDB reject it as a syntax error. Defaults
   * to `false`, the setting that works on every driver; turn it on for
   * PostgreSQL to make `ILIKE` genuinely case-insensitive. See
   * `FilterTranslatorOptions`.
   */
  readonly caseInsensitiveFilters?: boolean;
}

/**
 * The MikroORM implementation of core's infrastructure seam: metadata and
 * adapters derived from one `MikroORM` instance, cached per entity (metadata
 * derivation and adapter construction are bootstrap work, not per-request
 * work) — same shape as `@kavo/typeorm`'s `createInfrastructure`.
 *
 * The instance is held rather than an `EntityManager`, because every adapter
 * operation forks its own manager from it; see `MikroOrmRepositoryAdapter`.
 */
export function createInfrastructure(orm: MikroORM, options: MikroOrmInfrastructureOptions = {}): KavoInfrastructure {
  const metadataCache = new Map<ClassRef, EntityMetadata>();
  const adapterCache = new Map<ClassRef, RepositoryAdapter>();

  function metadataFor<Entity extends object>(entity: ClassRef<Entity>): EntityMetadata<Entity> {
    let metadata = metadataCache.get(entity);
    if (metadata === undefined) {
      metadata = buildEntityMetadata(orm, entity) as EntityMetadata;
      metadataCache.set(entity, metadata);
    }
    return metadata as EntityMetadata<Entity>;
  }

  return {
    metadataFor,
    adapterFor<Entity extends object>(entity: ClassRef<Entity>) {
      let adapter = adapterCache.get(entity);
      if (adapter === undefined) {
        adapter = new MikroOrmRepositoryAdapter(orm, metadataFor(entity), {
          caseInsensitiveFilters: options.caseInsensitiveFilters ?? false,
        }) as RepositoryAdapter;
        adapterCache.set(entity, adapter);
      }
      return adapter as RepositoryAdapter<Entity>;
    },
  };
}

/**
 * Sugar for the common case: a Kavo root instance wired to one MikroORM
 * instance, so `kavo.createCrud(Author)` is genuinely zero-config.
 */
export function createMikroOrmKavo(
  orm: MikroORM,
  options: MikroOrmInfrastructureOptions & Omit<KavoOptions, "infrastructure"> = {},
): KavoInstance {
  const { caseInsensitiveFilters, ...kavoOptions } = options;
  return createKavo({
    ...kavoOptions,
    infrastructure: createInfrastructure(orm, { caseInsensitiveFilters }),
  });
}
