import type { ErrorContext } from "@crudo/core";
import { ConflictException, CrudoException, PersistenceException, TransactionException } from "@crudo/core";
import { QueryFailedError } from "typeorm";

/**
 * The Phase 9 error-mapping table: driver error → Crudo exception.
 *
 * | Driver condition                  | Exception                          |
 * | --------------------------------- | ---------------------------------- |
 * | unique violation                  | ConflictException                  |
 * | foreign-key violation             | ConflictException                  |
 * | serialization failure / deadlock  | TransactionException (retryable)   |
 * | anything else                     | PersistenceException with `cause`  |
 *
 * Codes covered: Postgres SQLSTATE, MySQL errno, SQLite extended codes.
 * Unknown drivers fall through to `PersistenceException` — the original
 * error always travels as `cause`, never swallowed.
 */
export function mapDriverError(error: unknown, context: ErrorContext): CrudoException {
  if (error instanceof CrudoException) return error;

  const entity = context.entityName ?? "entity";
  if (error instanceof QueryFailedError) {
    const driver = error.driverError as { code?: string; errno?: number; message?: string } | undefined;
    const code = String(driver?.code ?? "");
    const errno = driver?.errno;
    const message = String(driver?.message ?? error.message);

    const unique =
      code === "23505" || // Postgres unique_violation
      errno === 1062 || // MySQL ER_DUP_ENTRY
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      (code.startsWith("SQLITE_CONSTRAINT") && /unique/i.test(message));
    const foreignKey =
      code === "23503" || // Postgres foreign_key_violation
      errno === 1452 || // MySQL ER_NO_REFERENCED_ROW_2
      errno === 1451 || // MySQL ER_ROW_IS_REFERENCED_2
      code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      (code.startsWith("SQLITE_CONSTRAINT") && /foreign key/i.test(message));
    if (unique || foreignKey) {
      return new ConflictException({
        messageParams: { entity },
        context,
        cause: error,
      });
    }

    const retryable =
      code === "40001" || // serialization_failure
      code === "40P01" || // Postgres deadlock_detected
      errno === 1213 || // MySQL ER_LOCK_DEADLOCK
      code === "SQLITE_BUSY";
    if (retryable) {
      return new TransactionException({ retryable: true, context, cause: error });
    }
  }

  return new PersistenceException({
    messageParams: { operation: context.operation ?? "unknown" },
    context,
    cause: error,
  });
}
