import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { ErrorContext } from "@kavo/core";
import { ConflictException, NotFoundException, PersistenceException, TransactionException } from "@kavo/core";
import { mapDriverError } from "@kavo/prisma";

function knownRequestError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Prisma error ${code}`, {
    code,
    clientVersion: "6.19.3",
    meta,
  });
}

const context: ErrorContext = {
  entityName: "Author",
  operation: "createOne",
  correlationId: "req-1",
};

describe("mapDriverError — unique and foreign-key violations", () => {
  it.each(["P2002", "P2003", "P2014"])("maps %s to a 409 conflict", (code) => {
    const mapped = mapDriverError(knownRequestError(code), context);
    expect(mapped).toBeInstanceOf(ConflictException);
    expect(mapped).toMatchObject({ code: "KAVO_CONFLICT", status: 409 });
  });

  it("names the entity in the conflict's message params", () => {
    expect(mapDriverError(knownRequestError("P2002"), context).messageParams).toEqual({ entity: "Author" });
  });

  it("falls back to a generic entity name when the context has none", () => {
    expect(mapDriverError(knownRequestError("P2002"), {}).messageParams).toEqual({ entity: "entity" });
  });
});

describe("mapDriverError — record-not-found and write conflicts", () => {
  it("maps P2025 to NotFoundException", () => {
    const mapped = mapDriverError(knownRequestError("P2025"), context);
    expect(mapped).toBeInstanceOf(NotFoundException);
    expect(mapped.status).toBe(404);
  });

  it("maps P2034 to a retryable transaction failure", () => {
    const mapped = mapDriverError(knownRequestError("P2034"), context);
    expect(mapped).toBeInstanceOf(TransactionException);
    expect(mapped).toMatchObject({ code: "KAVO_TRANSACTION_FAILED", status: 500 });
    expect((mapped as TransactionException).retryable).toBe(true);
  });
});

describe("mapDriverError — the fallback row", () => {
  it("maps an unrecognized Prisma code to a persistence failure", () => {
    const mapped = mapDriverError(knownRequestError("P2099"), context);
    expect(mapped).toBeInstanceOf(PersistenceException);
    expect(mapped).toMatchObject({ code: "KAVO_PERSISTENCE_FAILED", status: 500 });
  });

  it("carries the failing operation from the error context", () => {
    expect(mapDriverError(knownRequestError("P2099"), context).messageParams).toEqual({ operation: "createOne" });
  });

  it("reports the operation as 'unknown' when the context does not name one", () => {
    expect(mapDriverError(knownRequestError("P2099"), { entityName: "Author" }).messageParams).toEqual({
      operation: "unknown",
    });
  });

  it("wraps errors that are not PrismaClientKnownRequestError at all", () => {
    for (const raw of [new Error("ECONNRESET"), "boom", null]) {
      const mapped = mapDriverError(raw, context);
      expect(mapped).toBeInstanceOf(PersistenceException);
      expect(mapped.cause).toBe(raw);
    }
  });

  it("does not read a Prisma code off a look-alike that isn't a real Prisma error", () => {
    const lookAlike = Object.assign(new Error("unique violation"), { code: "P2002" });
    expect(mapDriverError(lookAlike, context)).toBeInstanceOf(PersistenceException);
  });
});

describe("mapDriverError — cause and context propagation", () => {
  const everyCode = ["P2002", "P2003", "P2014", "P2025", "P2034", "P2099"];

  it("keeps the original driver error as cause in every mapped case", () => {
    for (const code of everyCode) {
      const error = knownRequestError(code);
      expect(mapDriverError(error, context).cause).toBe(error);
    }
  });

  it("carries the error context onto every mapped exception", () => {
    for (const code of everyCode) {
      expect(mapDriverError(knownRequestError(code), context).context).toEqual(context);
    }
  });
});

describe("mapDriverError — Kavo exceptions pass through", () => {
  it("returns an already-mapped exception by identity, not a copy", () => {
    for (const original of [
      new NotFoundException({ messageParams: { entity: "Author", id: "7" } }),
      new ConflictException({ messageParams: { entity: "Author" } }),
      new TransactionException({ retryable: true }),
    ]) {
      expect(mapDriverError(original, context)).toBe(original);
    }
  });

  it("leaves the passed-through exception's own context untouched", () => {
    const original = new NotFoundException({ context: { entityName: "Book" } });
    expect(mapDriverError(original, context).context).toEqual({ entityName: "Book" });
  });
});
