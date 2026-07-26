import type { EntityId } from "../types/entity-id.js";
import type { EntityInput } from "../types/utility.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationId } from "../operations/operation.js";
import type { CrudCallOptions } from "../service/crud-call-options.js";

/**
 * The transport-agnostic request envelope handed to the engine — what the
 * framework layer (`@kavo/nest`) builds from an HTTP request, and what
 * programmatic callers are sugar for. Which members are populated depends
 * on the operation: `id` for `*One` targets, `body` for writes,
 * `query` for reads.
 */
export interface CrudRequest<
  Entity = unknown,
  Id extends EntityId = EntityId,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
> {
  readonly operation: OperationId;
  readonly id: Id | null;
  readonly body: CreateDto | UpdateDto | PatchDto | null;
  readonly query: QueryDto | null;
  /** Per-call override scope — parameters, never config writes. */
  readonly options: CrudCallOptions | null;
}
