/**
 * @kavo/mongoose — Mongoose implementation of core's `RepositoryAdapter`
 * and entity-metadata seam.
 *
 * Like every other package barrel this is an **explicit named list** (no
 * `export *`), per ADR-0010: the public surface changes only on purpose.
 */

export { buildEntityMetadata, asModel } from "./metadata.js";
export { mapDriverError } from "./error-mapping.js";
export {
  translateFilter,
  likeToRegExpSource,
  type FilterTranslatorOptions,
  type MongoWhere,
} from "./filter-translator.js";
export { assertQueryablePath } from "./relation-paths.js";
export { isObjectIdLike, toPlainDocument, toPlainResult } from "./plain-document.js";
export { MongooseRepositoryAdapter } from "./mongoose-repository-adapter.js";
export { createInfrastructure, createMongooseKavo } from "./infrastructure.js";
export {
  isModelLike,
  type MongooseConnectionLike,
  type MongooseModelLike,
  type MongooseSchemaLike,
  type MongooseSchemaOptionsLike,
  type MongooseSchemaTypeLike,
  type MongooseSchemaTypeOptions,
  type MongooseTimestampOptions,
} from "./mongoose-like.js";
