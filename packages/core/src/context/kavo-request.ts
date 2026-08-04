import type { EntityId } from "../types/entity-id.js";
import type { EntityInput } from "../types/utility.js";
import type { RequestPreconditions } from "../caching/etag.js";
import type { QueryContext } from "../query/query-context.js";
import type { OperationId } from "../operations/operation.js";
import type { KavoCallOptions } from "../service/kavo-call-options.js";

/**
 * The transport-agnostic request envelope handed to the engine — what the
 * framework layer (`@kavo/nest`) builds from an HTTP request, and what
 * programmatic callers are sugar for. Which members are populated depends
 * on the operation: `id` for `*One` targets, `body` for writes,
 * `query` for reads.
 */
export interface KavoRequest<
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
  readonly options: KavoCallOptions | null;
  /**
   * Conditional-request tokens (`If-Match` / `If-None-Match`), transport-
   * agnostic (ADR-0019). Optional so every existing caller keeps compiling;
   * absent and `null` mean the same thing — no precondition. When both this
   * and `options.preconditions` are set, this one wins, because it is the
   * request's own data rather than a per-call override of it.
   */
  readonly preconditions?: RequestPreconditions | null;
}
