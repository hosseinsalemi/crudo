/**
 * @crudo/typeorm — TypeORM adapter for Crudo (Phases 9–10).
 *
 * Implements `@crudo/core`'s `RepositoryAdapter` over a TypeORM
 * `DataSource` and feeds core's entity-metadata seam from TypeORM
 * metadata. `typeorm` is a peerDependency; `@crudo/core` never imports it.
 */
export { TypeOrmRepositoryAdapter } from "./typeorm-repository-adapter.js";
export { FilterTranslator } from "./filter-translator.js";
export { buildEntityMetadata } from "./metadata.js";
export { mapDriverError } from "./error-mapping.js";
export { createTypeOrmCrudo, createTypeOrmInfrastructure } from "./infrastructure.js";
