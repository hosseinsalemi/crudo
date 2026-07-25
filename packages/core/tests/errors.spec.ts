import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogedErrorCode, CrudException, QueryIssueDto } from "@crudo/core";
import {
  AlreadyDeletedException,
  ConfigurationException,
  ConflictException,
  CrudoException,
  DefaultErrorHandler,
  ERROR_CATALOG,
  NotDeletedException,
  NotFoundException,
  OperationDisabledException,
  PersistenceException,
  QueryValidationException,
  TransactionException,
  renderMessage,
  toProblemDetails,
} from "@crudo/core";

/**
 * The shipped catalog, pinned. Codes are API surface — renaming, restatusing
 * or dropping one is a breaking change (Phase 6; Phase 18 semver policy), so
 * it should cost a deliberate edit here.
 *
 * `CRUDO_BULK_FAILED` is absent on purpose: bulk was dropped, so the code is
 * not shipped (doc 06's table still lists it as reserved).
 */
const CATALOG: Readonly<Record<CatalogedErrorCode, { status: number; title: string }>> = {
  CRUDO_QUERY_INVALID: { status: 400, title: "Invalid query" },
  CRUDO_QUERY_INVALID_FIELD: { status: 400, title: "Invalid query field" },
  CRUDO_QUERY_INVALID_OPERATOR: { status: 400, title: "Invalid filter operator" },
  CRUDO_QUERY_INVALID_VALUE: { status: 400, title: "Invalid query value" },
  CRUDO_QUERY_LIMIT_EXCEEDED: { status: 400, title: "Query limit exceeded" },
  CRUDO_QUERY_UNSUPPORTED_PARAM: { status: 400, title: "Unsupported query parameter" },
  CRUDO_NOT_FOUND: { status: 404, title: "Not found" },
  CRUDO_CONFLICT: { status: 409, title: "Conflict" },
  CRUDO_ALREADY_DELETED: { status: 409, title: "Already deleted" },
  CRUDO_NOT_DELETED: { status: 409, title: "Not deleted" },
  CRUDO_OPERATION_DISABLED: { status: 405, title: "Operation disabled" },
  CRUDO_PERSISTENCE_FAILED: { status: 500, title: "Persistence failure" },
  CRUDO_TRANSACTION_FAILED: { status: 500, title: "Transaction failure" },
  CRUDO_CONFIG_INVALID: { status: 500, title: "Invalid configuration" },
};

/** Every `CRUDO_*` code literal appearing anywhere in core's source. */
function codesUsedInSource(): string[] {
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".ts"));
  const codes = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(new URL(file, root), "utf8").matchAll(/CRUDO_[A-Z][A-Z0-9_]*/g)) {
      codes.add(match[0]);
    }
  }
  return [...codes].sort();
}

describe("ERROR_CATALOG completeness (Phase 6)", () => {
  it("catalogs every error code core's source actually uses", () => {
    // `CrudoErrorCode` is an open template type, so the compiler cannot
    // close this gap: a new code with no catalog entry would render a title
    // of "Error" at runtime and go unnoticed.
    const used = codesUsedInSource();
    // Guards the guard: a scanner that found nothing would pass vacuously.
    expect(used.length).toBeGreaterThanOrEqual(Object.keys(ERROR_CATALOG).length);
    expect(used.filter((code) => !(code in ERROR_CATALOG))).toEqual([]);
  });

  it("ships exactly the pinned set of codes", () => {
    expect(Object.keys(ERROR_CATALOG).sort()).toEqual(Object.keys(CATALOG).sort());
  });

  it("binds the pinned HTTP status and title to each code", () => {
    for (const [code, expected] of Object.entries(CATALOG)) {
      expect(ERROR_CATALOG[code as CatalogedErrorCode]).toMatchObject(expected);
    }
  });

  it("gives every entry a usable status, title, and message template", () => {
    for (const entry of Object.values(ERROR_CATALOG)) {
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });
});

describe("renderMessage — message key + params (Phase 6)", () => {
  it("interpolates every {param} placeholder from the params bag", () => {
    expect(renderMessage("CRUDO_NOT_FOUND", { entity: "User", id: "7" })).toBe("User with id '7' was not found.");
  });

  it("stringifies numeric params", () => {
    expect(renderMessage("CRUDO_NOT_FOUND", { entity: "User", id: 7 })).toContain("'7'");
  });

  it("returns a placeholder-free template untouched", () => {
    expect(renderMessage("CRUDO_TRANSACTION_FAILED", {})).toBe(ERROR_CATALOG.CRUDO_TRANSACTION_FAILED.message);
  });

  it("ignores params the template does not name", () => {
    expect(renderMessage("CRUDO_CONFLICT", { entity: "User", stray: "x" })).toBe(
      "The operation conflicts with the current state of User.",
    );
  });

  it("leaves an unsupplied placeholder verbatim rather than printing 'undefined'", () => {
    // The spec fixes key + params as the localization contract but is silent
    // on a missing param; keeping the placeholder is what core does, and it
    // keeps the gap legible in the rendered detail.
    expect(renderMessage("CRUDO_NOT_FOUND", { entity: "User" })).toBe("User with id '{id}' was not found.");
  });
});

describe("exception hierarchy (Phase 6)", () => {
  const leaves = [
    { exception: new NotFoundException(), code: "CRUDO_NOT_FOUND", status: 404 },
    { exception: new ConflictException(), code: "CRUDO_CONFLICT", status: 409 },
    { exception: new AlreadyDeletedException(), code: "CRUDO_ALREADY_DELETED", status: 409 },
    { exception: new NotDeletedException(), code: "CRUDO_NOT_DELETED", status: 409 },
    { exception: new OperationDisabledException(), code: "CRUDO_OPERATION_DISABLED", status: 405 },
    { exception: new PersistenceException(), code: "CRUDO_PERSISTENCE_FAILED", status: 500 },
    { exception: new TransactionException(), code: "CRUDO_TRANSACTION_FAILED", status: 500 },
    { exception: new QueryValidationException([]), code: "CRUDO_QUERY_INVALID", status: 400 },
    { exception: new ConfigurationException("User", "operations.x", "why"), code: "CRUDO_CONFIG_INVALID", status: 500 },
  ] as const;

  it("binds each leaf to its catalog code and status", () => {
    for (const { exception, code, status } of leaves) {
      expect(exception.code).toBe(code);
      expect(exception.status).toBe(status);
      expect(exception.status).toBe(ERROR_CATALOG[code].status);
    }
  });

  it("is catchable as an Error and through the CrudoException base token", () => {
    for (const { exception } of leaves) {
      expect(exception).toBeInstanceOf(Error);
      expect(exception).toBeInstanceOf(CrudoException);
      expect(exception.name).toBe(exception.constructor.name);
    }
  });

  it("uses the code itself as the localization message key", () => {
    for (const { exception, code } of leaves) {
      expect(exception.messageKey).toBe(code);
    }
  });

  it("renders detail from the catalog template and the supplied params", () => {
    const exception = new NotFoundException({ messageParams: { entity: "User", id: 7 } });
    expect(exception.messageParams).toEqual({ entity: "User", id: 7 });
    expect(exception.detail).toBe("User with id '7' was not found.");
    expect(exception.message).toBe(exception.detail);
  });

  it("defaults messageParams and context to empty bags", () => {
    const exception = new ConflictException();
    expect(exception.messageParams).toEqual({});
    expect(exception.context).toEqual({});
    expect(exception.cause).toBeUndefined();
  });

  it("keeps the originating error as cause — never swallowed", () => {
    const cause = new Error("driver exploded");
    expect(new PersistenceException({ cause }).cause).toBe(cause);
  });

  it("carries the error context (entity, operation, correlation id)", () => {
    const context = { entityName: "User", operation: "findOne", correlationId: "abc" };
    expect(new NotFoundException({ context }).context).toEqual(context);
  });

  it("carries field-level issues on QueryValidationException under the aggregate code", () => {
    const issues: QueryIssueDto[] = [
      { field: "age", code: "CRUDO_QUERY_INVALID_VALUE", detail: "bad" },
      { field: "password", code: "CRUDO_QUERY_INVALID_FIELD", detail: "not allowlisted" },
    ];
    const exception = new QueryValidationException(issues);
    expect(exception.code).toBe("CRUDO_QUERY_INVALID");
    expect(exception.issues).toEqual(issues);
  });

  it("wraps the single-issue case into the same issues array", () => {
    const issue: QueryIssueDto = { field: "limit", code: "CRUDO_QUERY_INVALID_VALUE", detail: "bad" };
    const exception = QueryValidationException.single(issue);
    expect(exception).toBeInstanceOf(QueryValidationException);
    expect(exception.issues).toEqual([issue]);
  });

  it("marks a transaction retryable only when told so", () => {
    expect(new TransactionException().retryable).toBe(false);
    expect(new TransactionException({ retryable: true }).retryable).toBe(true);
  });

  it("names the entity, key path, and problem on a configuration error", () => {
    const exception = new ConfigurationException("User", "operations.purgeOne", "not soft-deletable");
    expect(exception.messageParams).toEqual({
      entity: "User",
      path: "operations.purgeOne",
      problem: "not soft-deletable",
    });
    expect(exception.context.entityName).toBe("User");
    expect(exception.detail).toContain("operations.purgeOne");
  });
});

describe("toProblemDetails — RFC 9457 document (Phase 6, ADR-0009)", () => {
  it("produces type, title, status, detail, and the code extension", () => {
    const exception = new NotFoundException({ messageParams: { entity: "User", id: 7 } });
    expect(toProblemDetails(exception)).toEqual({
      type: "https://crudo.dev/errors/crudo-not-found",
      title: "Not found",
      status: 404,
      detail: "User with id '7' was not found.",
      code: "CRUDO_NOT_FOUND",
    });
  });

  it("derives the type URI from the code for every cataloged code", () => {
    for (const code of Object.keys(ERROR_CATALOG) as CatalogedErrorCode[]) {
      const problem = toProblemDetails({
        code,
        status: ERROR_CATALOG[code].status,
        messageKey: code,
        messageParams: {},
        detail: "",
        context: {},
      });
      expect(problem.type).toBe(`https://crudo.dev/errors/${code.toLowerCase().replace(/_/g, "-")}`);
      expect(problem.title).toBe(ERROR_CATALOG[code].title);
    }
  });

  it("emits one errors[] entry per issue of a multi-issue query failure", () => {
    const issues: QueryIssueDto[] = [
      { field: "age", code: "CRUDO_QUERY_INVALID_VALUE", detail: "not a number" },
      { field: "password", code: "CRUDO_QUERY_INVALID_FIELD", detail: "not filterable" },
    ];
    const problem = toProblemDetails(new QueryValidationException(issues));
    expect(problem).toMatchObject({
      type: "https://crudo.dev/errors/crudo-query-invalid",
      status: 400,
      code: "CRUDO_QUERY_INVALID",
    });
    expect(problem.errors).toEqual(issues);
  });

  it("omits errors[] for a failure that carries no field-level issues", () => {
    expect(toProblemDetails(new ConflictException()).errors).toBeUndefined();
  });

  it("reports the correlation id as the instance URN, and omits it when absent", () => {
    const correlated = toProblemDetails(new NotFoundException({ context: { correlationId: "req-1" } }));
    expect(correlated.instance).toBe("urn:crudo:request:req-1");
    expect(toProblemDetails(new NotFoundException()).instance).toBeUndefined();
  });

  it("keeps driver detail out of the document unless exposeInternals is on", () => {
    const exception = new PersistenceException({ cause: new Error("SQLITE_BUSY") });
    expect(toProblemDetails(exception).detail).not.toContain("SQLITE_BUSY");
    expect(toProblemDetails(exception, { exposeInternals: true }).detail).toContain("SQLITE_BUSY");
  });
});

describe("DefaultErrorHandler — engine boundary mapping (Phase 6)", () => {
  const handler = new DefaultErrorHandler();

  it("passes a Crudo exception through with its code, status, and payload intact", () => {
    const original = new QueryValidationException([{ field: "age", code: "CRUDO_QUERY_INVALID_VALUE", detail: "x" }]);
    const handled = handler.handle(original, { entityName: "User", operation: "findMany" });
    expect(handled).toBeInstanceOf(QueryValidationException);
    expect(handled).toMatchObject({ code: "CRUDO_QUERY_INVALID", status: 400, detail: original.detail });
    expect((handled as QueryValidationException).issues).toEqual(original.issues);
  });

  it("fills in only the context the exception did not already know", () => {
    const original = new NotFoundException({ context: { entityName: "Account" } });
    const handled = handler.handle(original, {
      entityName: "User",
      operation: "findOne",
      correlationId: "req-1",
    });
    expect(handled.context).toEqual({
      entityName: "Account",
      operation: "findOne",
      correlationId: "req-1",
    });
  });

  it("wraps an untranslated error as a persistence failure, keeping the cause", () => {
    const driverError = new Error("ECONNRESET");
    const handled = handler.handle(driverError, { entityName: "User", operation: "createOne" });
    expect(handled).toBeInstanceOf(PersistenceException);
    expect(handled.code).toBe("CRUDO_PERSISTENCE_FAILED");
    expect(handled.status).toBe(500);
    expect(handled.cause).toBe(driverError);
    expect(handled.context).toMatchObject({ entityName: "User", operation: "createOne" });
    expect(handled.messageParams).toEqual({ operation: "createOne" });
  });

  it("wraps a thrown non-Error value just the same", () => {
    const handled = handler.handle("boom", {});
    expect(handled).toBeInstanceOf(PersistenceException);
    expect(handled.cause).toBe("boom");
    expect(handled.messageParams).toEqual({ operation: "unknown" });
  });

  it("hands the serializer a document a client can act on", () => {
    const handled: CrudException = handler.handle(new Error("boom"), {
      operation: "updateOne",
      correlationId: "req-2",
    });
    expect(toProblemDetails(handled)).toMatchObject({
      type: "https://crudo.dev/errors/crudo-persistence-failed",
      status: 500,
      instance: "urn:crudo:request:req-2",
    });
  });
});
