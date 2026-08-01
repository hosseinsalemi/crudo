/**
 * @kavo/typeorm — TypeORM adapter for Kavo.
 *
 * Implements `@kavo/core`'s `RepositoryAdapter` over a TypeORM
 * `DataSource` and feeds core's entity-metadata seam from TypeORM
 * metadata. `typeorm` is a peerDependency; `@kavo/core` never imports it.
 */
export { TypeOrmRepositoryAdapter } from "./typeorm-repository-adapter.js";
export { FilterTranslator } from "./filter-translator.js";
export { buildEntityMetadata } from "./metadata.js";
export { mapDriverError } from "./error-mapping.js";
export { createTypeOrmKavo, createInfrastructure } from "./infrastructure.js";
