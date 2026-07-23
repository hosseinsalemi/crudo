import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, Inject, Optional } from "@nestjs/common";
import { CrudoException, toProblemDetails } from "@crudo/core";
import { CRUDO_MODULE_OPTIONS } from "./tokens.js";
import type { CrudoModuleOptions } from "./crudo-options.js";

interface ProblemResponse {
  status(code: number): ProblemResponse;
  type(contentType: string): ProblemResponse;
  json(body: unknown): void;
}

/**
 * The one boundary between Crudo's exception hierarchy and HTTP
 * (Phase 11): every `CrudoException` becomes its RFC 9457 problem-details
 * document with the status from the error catalog. Crudo exceptions never
 * extend Nest's — this filter is the mapping, not inheritance.
 *
 * Registered globally by `CrudoModule.forRoot`; consumers can also apply
 * it per controller with `@UseFilters`.
 */
@Catch(CrudoException)
export class CrudoExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional()
    @Inject(CRUDO_MODULE_OPTIONS)
    private readonly options?: CrudoModuleOptions,
  ) {}

  catch(exception: CrudoException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ProblemResponse>();
    const body = toProblemDetails(exception, {
      exposeInternals: this.options?.defaults?.errors?.exposeInternals ?? false,
    });
    response
      .status(exception.status)
      .type("application/problem+json")
      .json(body);
  }
}
