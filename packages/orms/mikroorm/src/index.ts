/**
 * @kavo/mikroorm — MikroORM adapter for Kavo.
 *
 * Implements `@kavo/core`'s `RepositoryAdapter` over a MikroORM
 * `EntityManager` and feeds core's entity-metadata seam from MikroORM's own
 * `MetadataStorage`. `@mikro-orm/core` is a peerDependency; `@kavo/core`
 * never imports it.
 */
export { MikroOrmRepositoryAdapter } from "./mikro-orm-repository-adapter.js";
export { translateFilter, type FilterTranslatorOptions, type MikroWhere } from "./filter-translator.js";
export { buildEntityMetadata } from "./metadata.js";
export { mapDriverError } from "./error-mapping.js";
export { toPlain, toPlainAll } from "./plain-entity.js";
export { createInfrastructure, createMikroOrmKavo, type MikroOrmInfrastructureOptions } from "./infrastructure.js";
