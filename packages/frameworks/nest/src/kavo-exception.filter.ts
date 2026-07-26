import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, Inject, Optional } from "@nestjs/common";
import { KavoException, toProblemDetails } from "@kavo/core";
import { KAVO_MODULE_OPTIONS } from "./tokens.js";
import type { KavoModuleOptions } from "./kavo-options.js";

interface ProblemResponse {
  status(code: number): ProblemResponse;
  type(contentType: string): ProblemResponse;
  json(body: unknown): void;
}

/**
 * The one boundary between Kavo's exception hierarchy and HTTP
 * (Phase 11): every `KavoException` becomes its RFC 9457 problem-details
 * document with the status from the error catalog. Kavo exceptions never
 * extend Nest's — this filter is the mapping, not inheritance.
 *
 * Registered globally by `KavoModule.forRoot`; consumers can also apply
 * it per controller with `@UseFilters`.
 */
@Catch(KavoException)
export class KavoExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional()
    @Inject(KAVO_MODULE_OPTIONS)
    private readonly options?: KavoModuleOptions,
  ) {}

  catch(exception: KavoException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ProblemResponse>();
    const body = toProblemDetails(exception, {
      exposeInternals: this.options?.defaults?.errors?.exposeInternals ?? false,
    });
    response.status(exception.status).type("application/problem+json").json(body);
  }
}
