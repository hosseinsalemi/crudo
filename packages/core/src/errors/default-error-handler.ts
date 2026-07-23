import type { ErrorContext, ErrorHandler, CrudException } from "./crud-exception.js";
import { CrudoException, PersistenceException } from "./exceptions.js";

/**
 * The engine-boundary error mapper (Phase 6). Adapter-specific errors were
 * already translated by the adapter's own mapping table (Phase 9) into
 * Crudo exceptions; whatever still arrives untranslated becomes a
 * `PersistenceException` with the original as `cause` — never swallowed.
 *
 * Context enrichment: an exception thrown deep in the pipeline may not
 * know the entity/operation it ran under; the handler fills in whatever
 * the exception's own context is missing.
 */
export class DefaultErrorHandler implements ErrorHandler {
  handle(error: unknown, context: ErrorContext): CrudException {
    if (error instanceof CrudoException) {
      return this.enrich(error, context);
    }
    return new PersistenceException({
      messageParams: { operation: context.operation ?? "unknown" },
      context,
      cause: error,
    });
  }

  private enrich(exception: CrudoException, context: ErrorContext): CrudException {
    const merged: ErrorContext = {
      entityName: exception.context.entityName ?? context.entityName,
      operation: exception.context.operation ?? context.operation,
      correlationId: exception.context.correlationId ?? context.correlationId,
    };
    // Exceptions are immutable value carriers; rather than mutate, expose
    // the enriched context through a same-shape proxy object.
    return Object.create(exception, {
      context: { value: merged, enumerable: true },
    }) as CrudException;
  }
}
