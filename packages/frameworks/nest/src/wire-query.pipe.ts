import type { PipeTransform } from "@nestjs/common";
import { WireQuery } from "@kavo/core";
import { flattenQuery } from "./flatten-query.js";

/**
 * Backs every read-kind `@Query()` param `@Crud` applies — to a generated
 * route and to an `@Override`'d method alike, since both go through the same
 * `applyParamDecorators` call site. Wrapping this in Nest's own pipe seam
 * (rather than wrapping the value inside `makeHandler`) is what lets an
 * override receive an already-normalized `WireQuery`: Nest runs the pipe
 * before *any* method body executes, including a hand-written one.
 *
 * `flattenQuery` is itself idempotent against an already-`WireQuery` input
 * (see its docs) — the case this guards is an `@Override`'d method written
 * before issue #25 that still wraps its `query` param manually.
 */
export class WireQueryPipe implements PipeTransform<unknown, WireQuery> {
  transform(value: unknown): WireQuery {
    return new WireQuery(flattenQuery((value ?? {}) as Readonly<Record<string, unknown>>));
  }
}
