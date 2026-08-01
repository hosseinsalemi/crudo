import type { ErrorContext, ErrorHandler, KavoExceptionShape } from "./kavo-exception-shape.js";
import { KavoException, PersistenceException } from "./exceptions.js";

/**
 * The engine-boundary error mapper. Adapter-specific errors were
 * already translated by the adapter's own mapping table into
 * Kavo exceptions; whatever still arrives untranslated becomes a
 * `PersistenceException` with the original as `cause` — never swallowed.
 *
 * Context enrichment: an exception thrown deep in the pipeline may not
 * know the entity/operation it ran under; the handler fills in whatever
 * the exception's own context is missing.
 */
export class DefaultErrorHandler implements ErrorHandler {
  handle(error: unknown, context: ErrorContext): KavoExceptionShape {
    if (error instanceof KavoException) {
      return this.enrich(error, context);
    }
    return new PersistenceException({
      messageParams: { operation: context.operation ?? "unknown" },
      context,
      cause: error,
    });
  }

  private enrich(exception: KavoException, context: ErrorContext): KavoExceptionShape {
    const merged: ErrorContext = {
      entityName: exception.context.entityName ?? context.entityName,
      operation: exception.context.operation ?? context.operation,
      correlationId: exception.context.correlationId ?? context.correlationId,
    };
    // Exceptions are immutable value carriers; rather than mutate, expose
    // the enriched context through a same-shape proxy object.
    return Object.create(exception, {
      context: { value: merged, enumerable: true },
    }) as KavoExceptionShape;
  }
}
