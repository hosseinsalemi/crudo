import type { ListResultDto } from "../dto/list-result.js";
import type { OperationId } from "../operations/operation.js";

/**
 * The transport-agnostic result envelope the engine returns. Exactly one
 * result shape is populated, matching the operation's cardinality:
 * `item` for `*One` results and `list` for `findMany`; both are `null`
 * for void results (`deleteOne`, `purgeOne`).
 */
export interface KavoResponse<ItemDto = unknown, ListDto = ItemDto> {
  readonly operation: OperationId;
  readonly item: ItemDto | null;
  readonly list: ListResultDto<ListDto> | null;
}
