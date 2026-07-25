/**
 * @crudo/core — framework- and ORM-independent contracts and type system.
 *
 * This barrel is an **explicit named list**, kept deliberately (no
 * `export *`): the public surface should only ever change on purpose, the
 * future api-extractor gate (Phase 18) diffs against it, and module
 * augmentation of `OperationMetadata` needs a stable module to target.
 */

// ── Foundational types ────────────────────────────────────────────────
export type { EntityId } from "./types/entity-id.js";
export type { FieldPath, FieldPathDepth } from "./types/field-path.js";
export type { IncludePath } from "./types/include-path.js";
export type {
  ClassRef,
  DeepPartial,
  EntityInput,
  IsAny,
  IsUnknown,
  NonFunctionKeys,
  Primitive,
  ScalarKeys,
} from "./types/utility.js";

// ── Query model ───────────────────────────────────────────────────────
export type {
  FilterExpression,
  FilterOperator,
  FilterScalar,
  FilterValue,
  Filter,
  FilterCondition,
  FilterGroup,
  LogicalOperator,
} from "./query/filter.js";
export type { Pagination, PaginationLimits, PaginationStrategy } from "./query/pagination.js";
export type { Sort, SortDirection } from "./query/sort.js";
export type { FieldSelection, FieldSelectionInput } from "./query/field-selection.js";
export type { NormalizedQueryContext, QueryContext } from "./query/query-context.js";
export type { FilterParser } from "./query/filter-parser.js";
export type { FilterBuilder } from "./query/filter-builder.js";

// ── DTO system ────────────────────────────────────────────────────────
export type { DtoClass, DtoSlot, Dto, DtoResolver, OperationDtoMap } from "./dto/dto.js";
export type { ListMetaDto, ListResultDto } from "./dto/list-result.js";

// ── Errors ────────────────────────────────────────────────────────────
export type { CrudoErrorCode, CrudException, ErrorContext, ErrorHandler } from "./errors/crud-exception.js";
export type { ProblemDetailsDto, QueryIssueDto } from "./errors/problem-details.js";

// ── Configuration ─────────────────────────────────────────────────────
export type {
  CrudoSettings,
  ErrorSettings,
  PaginationSettings,
  QuerySettings,
  RelationEdgeSettings,
  RelationSettings,
  SoftDeleteMode,
  SoftDeleteSettings,
  PaginationStrategyName,
} from "./config/settings.js";
export type { GlobalConfig } from "./config/global-config.js";
export type { CustomOperationConfig, EntityConfig, OperationConfig, QueryAllowlists } from "./config/entity-config.js";
export type { ResolvedEntityConfig, ResolvedQueryAllowlists } from "./config/resolved-entity-config.js";

// ── Operations ────────────────────────────────────────────────────────
export type { OperationCardinality, OperationId, OperationKind, StandardOperationId } from "./operations/operation.js";
export type { OperationHandler, OperationMetadata } from "./operations/operation-handler.js";
export type { OperationDescriptor, OperationRegistry } from "./operations/operation-registry.js";

// ── Relations & includes ──────────────────────────────────────────────
export type { RelationDescriptor, RelationCardinality, RelationLoadStrategy } from "./relations/relation-descriptor.js";
export type { RelationRegistry } from "./relations/relation-registry.js";
export type { IncludeNode, IncludeTree } from "./relations/include-tree.js";
export type { IncludeRequest, IncludeResolver } from "./relations/include-resolver.js";
export { DefaultIncludeResolver } from "./relations/default-include-resolver.js";

// ── Request context & envelopes ───────────────────────────────────────
export type { CrudContext, CrudContextState, StateKey } from "./context/crud-context.js";
export type { CrudRequest } from "./context/crud-request.js";
export type { CrudResponse } from "./context/crud-response.js";

// ── Serialization ─────────────────────────────────────────────────────
export type { Deserializer, Serializer } from "./serialization/serializer.js";

// ── Persistence ───────────────────────────────────────────────────────
export type { EntityReader } from "./persistence/entity-reader.js";
export type { EntityWriter } from "./persistence/entity-writer.js";
export type { RepositoryAdapter } from "./persistence/repository-adapter.js";
export type { DeleteStrategy, ResolvedSoftDelete, SoftDeletable } from "./persistence/soft-delete.js";
export type {
  TransactionContext,
  TransactionManager,
  TransactionOptions,
  TransactionPropagation,
} from "./persistence/transaction-manager.js";

// ── Service surface ───────────────────────────────────────────────────
export type { CrudCallOptions } from "./service/crud-call-options.js";
export type { CrudService } from "./service/crud-service.js";

// ════════════════════════════════════════════════════════════════════
// Runtime — implementations of the contracts above.
// ════════════════════════════════════════════════════════════════════

// ── Type-system guards ────────────────────────────────────────────────
export { assertNever } from "./types/assert-never.js";

// ── Entity metadata seam ──────────────────────────────────────────────
export type { CrudInfrastructure, EntityMetadata, FieldKind, FieldMetadata } from "./metadata/entity-metadata.js";
export {
  DefaultEntityCatalog,
  type EntityCatalog,
  type EntityRuntimeInfo,
  type MetadataSource,
} from "./metadata/entity-catalog.js";

// ── Errors ────────────────────────────────────────────────────────────
export {
  ERROR_CATALOG,
  renderMessage,
  type CatalogedErrorCode,
  type ErrorCatalogEntry,
} from "./errors/error-catalog.js";
export {
  AlreadyDeletedException,
  ConfigurationException,
  ConflictException,
  CrudoException,
  NotDeletedException,
  NotFoundException,
  OperationDisabledException,
  PersistenceException,
  QueryValidationException,
  TransactionException,
  type CrudoExceptionOptions,
} from "./errors/exceptions.js";
export { toProblemDetails, type ProblemDetailsOptions } from "./errors/problem-details-serializer.js";
export { DefaultErrorHandler } from "./errors/default-error-handler.js";

// ── Configuration runtime ─────────────────────────────────────────────
export { BUILT_IN_DEFAULTS } from "./config/defaults.js";
export { deepFreeze, mergeSettings } from "./config/merge-settings.js";
export { validateSettings } from "./config/validate-settings.js";
export { describeResolvedConfig, resolveEntityConfig } from "./config/resolve-entity-config.js";
export { HARD_DELETE, resolveSoftDelete } from "./persistence/soft-delete.js";

// ── DTO & serialization runtime ───────────────────────────────────────
export { DefaultDtoResolver } from "./dto/default-dto-resolver.js";
export { dtoShapeKeys } from "./dto/dto-shape.js";
export { DefaultDeserializer, DefaultSerializer } from "./serialization/default-serializer.js";

// ── Query runtime ─────────────────────────────────────────────────────
export { DefaultFilterParser } from "./query/default-filter-parser.js";
export {
  OffsetPaginationStrategy,
  PagePaginationStrategy,
  builtInPaginationStrategies,
} from "./query/pagination-strategies.js";
export { QueryNormalizer } from "./query/query-normalizer.js";
export { parseBracketKey } from "./query/bracket-notation.js";

// ── Operations & engine runtime ───────────────────────────────────────
export {
  DefaultOperationRegistry,
  STANDARD_OPERATIONS,
  createOperationRegistry,
  type StandardHandlerFactory,
} from "./operations/default-operation-registry.js";
export { builtInHandlers, type FindManyResult, type IdentifiedWrite } from "./engine/built-in-handlers.js";
export { CrudEngine, WireQuery, type CrudEngineDependencies } from "./engine/crud-engine.js";
export { DefaultCrudContextState, createCrudContext, type CrudContextInit } from "./context/default-crud-context.js";
export { DefaultRelationRegistry } from "./relations/default-relation-registry.js";

// ── Service & root factory ────────────────────────────────────────────
export { DefaultCrudService } from "./service/default-crud-service.js";
export { createCrud, createCrudo, type CrudRuntime, type CrudoInstance, type CrudoOptions } from "./crudo.js";
