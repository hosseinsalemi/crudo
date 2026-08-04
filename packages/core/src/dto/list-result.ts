/**
 * Open, extensible metadata bag on the list envelope, kept out of the
 * envelope's first-class fields. It is `{}` until something contributes.
 *
 * What fills it is the `findMany` handler's optional `FindManyResult.meta`
 * — return it and the engine merges it onto the envelope verbatim, with no
 * DTO projection and no field selection. `withListMeta(handler, compute)`
 * is the ergonomic wrap for the common "add one stat" case. It is also the
 * seam pagination strategies and consumer middleware extend: cursor
 * pagination is the one contributor core itself writes, folding in
 * `meta.nextCursor` (ADR-0021).
 *
 * Not to be confused with `OperationConfig.meta` (`OperationMetadata`,
 * ADR-0007), which is route/framework metadata and never reaches a
 * response body.
 */
export interface ListMetaDto {
  readonly [key: string]: unknown;
}

/**
 * The list response envelope (normative).
 *
 * Pagination fields are flat at the top level: they are first-class
 * response data every consumer needs, not metadata. `limit`/`offset`
 * mirror the default wire params and the internal `Pagination` form, so a
 * request and its response read symmetrically.
 */
export interface ListResultDto<ListDto> {
  readonly items: readonly ListDto[];
  /** Effective page size the server applied. */
  readonly limit: number;
  /**
   * Zero-based index of `items[0]` within the full match set.
   *
   * Always `0` under cursor pagination: a keyset page knows only what comes
   * after a row, not how many rows precede it, and this field is not
   * nullable (ADR-0021). Cursor clients page with `meta.nextCursor`.
   */
  readonly offset: number;
  /**
   * Total matching items; `null` when counting is disabled — `COUNT(*)` is
   * a real cost the config can turn off.
   */
  readonly total: number | null;
  readonly meta: ListMetaDto;
}
