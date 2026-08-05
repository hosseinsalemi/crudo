import { describe, expect, it } from "vitest";
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { toKavoExceptionShape } from "../src/unhandled-exception.js";

describe("toKavoExceptionShape", () => {
  it("maps a string-body HttpException to KAVO_HTTP_ERROR at its own status", () => {
    const shape = toKavoExceptionShape(new NotFoundException("no boom here"));
    expect(shape.code).toBe("KAVO_HTTP_ERROR");
    expect(shape.status).toBe(404);
    expect(shape.detail).toContain("no boom here");
  });

  it("joins an array `message` (ValidationPipe shape) into one detail string", () => {
    const shape = toKavoExceptionShape(new BadRequestException(["title must be a string", "title is required"]));
    expect(shape.status).toBe(400);
    expect(shape.detail).toContain("title must be a string");
    expect(shape.detail).toContain("title is required");
  });

  it("maps a plain thrown Error to KAVO_UNEXPECTED_ERROR at 500, keeping it as the cause", () => {
    const original = new Error("db pool exhausted");
    const shape = toKavoExceptionShape(original);
    expect(shape.code).toBe("KAVO_UNEXPECTED_ERROR");
    expect(shape.status).toBe(500);
    expect(shape.cause).toBe(original);
    expect(shape.detail).not.toContain("db pool exhausted");
  });

  it.each([
    ["a string", "just a string throw"],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { reason: "not an Error at all" }],
  ])("maps %s thrown value to KAVO_UNEXPECTED_ERROR without throwing itself", (_label, thrown) => {
    const shape = toKavoExceptionShape(thrown);
    expect(shape.code).toBe("KAVO_UNEXPECTED_ERROR");
    expect(shape.status).toBe(500);
    expect(shape.cause).toBe(thrown);
  });

  it("falls back to the HttpException's own .message when getResponse() has no message field", () => {
    const shape = toKavoExceptionShape(new HttpException({ statusCode: 400 }, 400));
    expect(shape.status).toBe(400);
    expect(shape.detail.length).toBeGreaterThan(0);
  });

  it("never sets a correlation instance for either synthetic shape", () => {
    expect(toKavoExceptionShape(new NotFoundException("x")).context.correlationId).toBeUndefined();
    expect(toKavoExceptionShape(new Error("x")).context.correlationId).toBeUndefined();
  });
});
