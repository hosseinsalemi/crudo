import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs";
import type { KavoResponse } from "@kavo/core";

/**
 * What this needs from the outgoing response, duck-typed rather than
 * imported: `header`/`status` are spelled the same on an Express `res` and
 * a Fastify `reply`, so one interceptor serves both adapters. Same trick,
 * and same reason, as `ProblemResponse` in `kavo-exception.filter.ts`.
 */
interface ConditionalResponse {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
}

const NOT_MODIFIED = 304;

/**
 * The one place a generated route's `KavoResponse` becomes an HTTP
 * response: the `ETag` header is set from the envelope, a not-modified
 * read becomes a bodyless `304`, and everything else is unwrapped to the
 * `item` or the list envelope the client actually expects (ADR-0019).
 *
 * Applied method-scoped, by `@Kavo`, to generated handlers only — a
 * hand-written or `@Override`'d method returns its own value and is left
 * alone. Being the innermost interceptor, it unwraps before any
 * controller- or app-level interceptor sees the result, so nothing
 * downstream ever meets the envelope.
 *
 * Setting the status here works because Nest applies the route's static
 * `@HttpCode` *before* interceptors run and does not re-apply it when
 * replying, so a later `status()` call is the one that survives.
 */
export class KavoResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => unwrap(context, value)));
  }
}

function unwrap(context: ExecutionContext, value: unknown): unknown {
  if (!isKavoResponse(value)) return value;
  const response = context.switchToHttp().getResponse<ConditionalResponse>();
  if (value.etag !== null) response.header("ETag", value.etag);
  if (value.notModified) {
    response.status(NOT_MODIFIED);
    return undefined;
  }
  // Void operations leave both slots null, which becomes an empty body.
  return value.list ?? value.item;
}

function isKavoResponse(value: unknown): value is KavoResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "operation" in value &&
    "item" in value &&
    "list" in value &&
    "etag" in value &&
    "notModified" in value
  );
}
