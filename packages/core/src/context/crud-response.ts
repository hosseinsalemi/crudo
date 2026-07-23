import type { ListResultDto } from "../dto/list-result.js";
import type { BulkResultDto } from "../dto/bulk-result.js";
import type { OperationId } from "../operations/operation.js";

/**
 * The transport-agnostic result envelope the engine returns. Exactly one
 * result shape is populated, matching the operation's cardinality:
 * `item` for `*One` results, `list` for `findMany`, `bulk` for `*Many`
 * writes; all three are `null` for void results (`deleteOne`, `purgeOne`).
 */
export interface CrudResponse<ItemDto = unknown, ListDto = ItemDto> {
  readonly operation: OperationId;
  readonly item: ItemDto | null;
  readonly list: ListResultDto<ListDto> | null;
  readonly bulk: BulkResultDto<ItemDto> | null;
}
