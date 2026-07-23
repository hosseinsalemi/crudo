/**
 * @crudo/core — framework- and ORM-independent contracts and type system.
 *
 * This barrel is an **explicit named list**, kept deliberately (no
 * `export *`): the public surface should only ever change on purpose, the
 * future api-extractor gate (Phase 19) diffs against it, and module
 * augmentation of `OperationMetadata` needs a stable module to target.
 */

// ── Foundational types ────────────────────────────────────────────────
export type { EntityId } from "./types/entity-id.js";
export type { FieldPath, FieldPathDepth } from "./types/field-path.js";
export type {
  ClassRef,
  DeepPartial,
  EntityInput,
  IsAny,
  IsUnknown,
  NonFunctionKeys,
  Primitive,
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
export type {
  Pagination,
  PaginationLimits,
  PaginationStrategy,
} from "./query/pagination.js";
export type { Sort, SortDirection } from "./query/sort.js";
export type { FieldSelection } from "./query/field-selection.js";
export type {
  NormalizedQueryContext,
  QueryContext,
} from "./query/query-context.js";
export type { FilterParser } from "./query/filter-parser.js";
export type { FilterBuilder } from "./query/filter-builder.js";

// ── DTO system ────────────────────────────────────────────────────────
export type {
  DtoClass,
  DtoSlot,
  Dto,
  DtoResolver,
  OperationDtoMap,
} from "./dto/dto.js";
export type { ListMetaDto, ListResultDto } from "./dto/list-result.js";
export type {
  BulkItemFailureDto,
  BulkResultDto,
} from "./dto/bulk-result.js";

// ── Errors ────────────────────────────────────────────────────────────
export type {
  CrudoErrorCode,
  CrudException,
  ErrorContext,
  ErrorHandler,
} from "./errors/crud-exception.js";
export type {
  BulkItemIssueDto,
  ProblemDetailsDto,
  QueryIssueDto,
} from "./errors/problem-details.js";

// ── Configuration ─────────────────────────────────────────────────────
export type {
  BulkMode,
  BulkSettings,
  CrudoSettings,
  ErrorSettings,
  PaginationSettings,
  QuerySettings,
  RelationSettings,
  SoftDeleteSettings,
  PaginationStrategyName,
} from "./config/settings.js";
export type { GlobalConfig } from "./config/global-config.js";
export type {
  CustomOperationConfig,
  EntityConfig,
  OperationConfig,
  QueryAllowlists,
} from "./config/entity-config.js";
export type {
  ResolvedEntityConfig,
  ResolvedQueryAllowlists,
} from "./config/resolved-entity-config.js";

// ── Operations ────────────────────────────────────────────────────────
export type {
  OperationCardinality,
  OperationId,
  OperationKind,
  StandardOperationId,
} from "./operations/operation.js";
export type {
  OperationHandler,
  OperationMetadata,
} from "./operations/operation-handler.js";
export type {
  OperationDescriptor,
  OperationRegistry,
} from "./operations/operation-registry.js";

// ── Relations & includes ──────────────────────────────────────────────
export type {
  RelationDescriptor,
  RelationCardinality,
  RelationLoadStrategy,
} from "./relations/relation-descriptor.js";
export type { RelationRegistry } from "./relations/relation-registry.js";
export type { IncludeNode, IncludeTree } from "./relations/include-tree.js";
export type { IncludeResolver } from "./relations/include-resolver.js";

// ── Request context & envelopes ───────────────────────────────────────
export type {
  CrudContext,
  CrudContextState,
  StateKey,
} from "./context/crud-context.js";
export type { CrudRequest } from "./context/crud-request.js";
export type { CrudResponse } from "./context/crud-response.js";

// ── Serialization ─────────────────────────────────────────────────────
export type { Deserializer, Serializer } from "./serialization/serializer.js";

// ── Persistence ───────────────────────────────────────────────────────
export type { EntityReader } from "./persistence/entity-reader.js";
export type { EntityWriter } from "./persistence/entity-writer.js";
export type { RepositoryAdapter } from "./persistence/repository-adapter.js";
export type {
  TransactionContext,
  TransactionManager,
  TransactionOptions,
  TransactionPropagation,
} from "./persistence/transaction-manager.js";

// ── Service surface ───────────────────────────────────────────────────
export type { CrudCallOptions } from "./service/crud-call-options.js";
export type {
  CrudService,
  IdentifiedInput,
} from "./service/crud-service.js";
