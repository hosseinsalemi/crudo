import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import {
  ConflictException,
  NotFoundException,
  PersistenceException,
  QueryValidationException,
  TransactionException,
} from "@kavo/core";
import { mapDriverError } from "@kavo/mongoose";

const CONTEXT = { entityName: "Book", operation: "findOne", correlationId: "c-1" };

/** A well-formed ObjectId that is never inserted. */
const ABSENT_ID = "507f1f77bcf86cd799439011";

/**
 * A MongoDB server error as the driver raises it. Built structurally rather
 * than imported: `MongoServerError` lives in the `mongodb` package, which is
 * Mongoose's own dependency and not a peer this package declares.
 */
function serverError(code: number): Error {
  return Object.assign(new Error(`server error ${code}`), { name: "MongoServerError", code });
}

describe("mapDriverError — cast failures", () => {
  it("answers 404 for an id that is not a valid ObjectId", () => {
    // Real Mongoose error, so the mapping is pinned to the actual shape.
    const error = new mongoose.Error.CastError("ObjectId", "not-an-objectid", "_id");
    const mapped = mapDriverError(error, CONTEXT, "_id");
    expect(mapped).toBeInstanceOf(NotFoundException);
    expect(mapped.code).toBe("KAVO_NOT_FOUND");
    expect(mapped.cause).toBe(error);
  });

  it("renders the rejected id, so a malformed id reads like an absent one", () => {
    // The whole point of answering 404 here is that a malformed id must be
    // indistinguishable from a well-formed one that isn't there. Rendering
    // an empty id would itself be the key-format oracle: "with id ''" says
    // "that was not an ObjectId", while "with id 'not-an-objectid'" does not.
    const mapped = mapDriverError(new mongoose.Error.CastError("ObjectId", "not-an-objectid", "_id"), CONTEXT, "_id");
    expect(mapped.message).toContain("not-an-objectid");
    expect(mapped.message).not.toContain("''");

    const absent = mapDriverError(new mongoose.Error.CastError("ObjectId", ABSENT_ID, "_id"), CONTEXT, "_id");
    // Same sentence, only the id differs — no shape change to read a signal from.
    expect(mapped.message.replace("not-an-objectid", "X")).toBe(absent.message.replace(ABSENT_ID, "X"));
  });

  it("answers 400 for a cast failure on any other path", () => {
    const error = new mongoose.Error.CastError("ObjectId", "nope", "author");
    const mapped = mapDriverError(error, CONTEXT, "_id");
    expect(mapped).toBeInstanceOf(QueryValidationException);
    expect(mapped.code).toBe("KAVO_QUERY_INVALID");
    expect((mapped as QueryValidationException).issues[0]).toMatchObject({
      field: "author",
      code: "KAVO_QUERY_INVALID_VALUE",
    });
    expect(mapped.status).toBe(400);
  });

  it("does not treat a cast failure as a 404 when no id field is supplied", () => {
    const error = new mongoose.Error.CastError("ObjectId", "nope", "_id");
    expect(mapDriverError(error, CONTEXT)).toBeInstanceOf(QueryValidationException);
  });
});

describe("mapDriverError — server errors", () => {
  it("maps duplicate-key violations to a 409 conflict", () => {
    for (const code of [11000, 11001]) {
      const mapped = mapDriverError(serverError(code), CONTEXT, "_id");
      expect(mapped).toBeInstanceOf(ConflictException);
      expect(mapped.code).toBe("KAVO_CONFLICT");
    }
  });

  it("maps a write conflict to a retryable transaction failure", () => {
    const mapped = mapDriverError(serverError(112), CONTEXT, "_id");
    expect(mapped).toBeInstanceOf(TransactionException);
    expect(mapped.code).toBe("KAVO_TRANSACTION_FAILED");
    expect((mapped as TransactionException).retryable).toBe(true);
  });

  it("falls through to a persistence failure for an unmapped server code", () => {
    const error = serverError(9999);
    const mapped = mapDriverError(error, CONTEXT, "_id");
    expect(mapped).toBeInstanceOf(PersistenceException);
    expect(mapped.code).toBe("KAVO_PERSISTENCE_FAILED");
    expect(mapped.cause).toBe(error);
  });
});

describe("mapDriverError — pass-through and fallback", () => {
  it("returns a Kavo exception unchanged rather than re-wrapping it", () => {
    const original = new NotFoundException({ messageParams: { entity: "Book", id: "1" } });
    expect(mapDriverError(original, CONTEXT, "_id")).toBe(original);
  });

  it("leaves schema validation unmapped, preserving the cause", () => {
    // Doc 06 scopes every catalogued 400 to query grammar/allowlists/limits;
    // an adapter minting a request-body validation code would be widening
    // core's error contract from the outside.
    const error = new mongoose.Error.ValidationError();
    const mapped = mapDriverError(error, CONTEXT, "_id");
    expect(mapped).toBeInstanceOf(PersistenceException);
    expect(mapped.cause).toBe(error);
  });

  it("carries the error context onto the mapped exception", () => {
    expect(mapDriverError(serverError(9999), CONTEXT, "_id").context).toMatchObject({
      entityName: "Book",
      operation: "findOne",
      correlationId: "c-1",
    });
  });

  it("wraps a non-Error value without throwing", () => {
    const mapped = mapDriverError("boom", CONTEXT, "_id");
    expect(mapped).toBeInstanceOf(PersistenceException);
    expect(mapped.cause).toBe("boom");
  });
});
