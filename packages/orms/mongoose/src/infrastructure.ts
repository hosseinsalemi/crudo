import type {
  ClassRef,
  EntityMetadata,
  KavoInfrastructure,
  KavoInstance,
  KavoOptions,
  RepositoryAdapter,
} from "@kavo/core";
import { createKavo } from "@kavo/core";
import { buildEntityMetadata } from "./metadata.js";
import { MongooseRepositoryAdapter } from "./mongoose-repository-adapter.js";
import type { MongooseConnectionLike } from "./mongoose-like.js";

/**
 * The Mongoose implementation of core's infrastructure seam (ADR-0011):
 * metadata and adapters derived from one connection's models, cached per
 * entity because metadata derivation and adapter construction are bootstrap
 * work, not per-request work.
 *
 * `connection` is only ever consulted to resolve a relation's `ref` to its
 * target model, which is why there is no `entities` list to declare here —
 * a Mongoose model is a constructor and therefore already core's `ClassRef`
 * identity, and `connection.models` is the registry Prisma has to ask the
 * caller to rebuild by hand (ADR-0017 vs. ADR-0018).
 *
 * Both `mongoose` and `mongoose.connection` satisfy
 * {@link MongooseConnectionLike}, as does a `mongoose.createConnection()`
 * handle for a multi-database app:
 *
 * ```ts
 * const kavo = createMongooseKavo(mongoose.connection);
 * const users = kavo.createCrud(User); // User = mongoose.model('User', schema)
 * ```
 */
export function createMongooseInfrastructure(connection: MongooseConnectionLike): KavoInfrastructure {
  const metadataCache = new Map<ClassRef, EntityMetadata>();
  const adapterCache = new Map<ClassRef, RepositoryAdapter>();

  function metadataFor<Entity extends object>(entity: ClassRef<Entity>): EntityMetadata<Entity> {
    let metadata = metadataCache.get(entity);
    if (metadata === undefined) {
      metadata = buildEntityMetadata(entity, connection) as EntityMetadata;
      metadataCache.set(entity, metadata);
    }
    return metadata as EntityMetadata<Entity>;
  }

  return {
    metadataFor,
    adapterFor<Entity extends object>(entity: ClassRef<Entity>) {
      let adapter = adapterCache.get(entity);
      if (adapter === undefined) {
        adapter = new MongooseRepositoryAdapter(metadataFor(entity)) as RepositoryAdapter;
        adapterCache.set(entity, adapter);
      }
      return adapter as RepositoryAdapter<Entity>;
    },
  };
}

/**
 * Sugar for the common case: a Kavo root instance wired to one Mongoose
 * connection, so `kavo.createCrud(User)` is genuinely zero-config — no
 * schema mirror, no entity list, nothing to keep in sync with the models
 * the app already declared.
 */
export function createMongooseKavo(
  connection: MongooseConnectionLike,
  options: Omit<KavoOptions, "infrastructure"> = {},
): KavoInstance {
  return createKavo({
    ...options,
    infrastructure: createMongooseInfrastructure(connection),
  });
}
