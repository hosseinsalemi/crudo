import { describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
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

  it("maps a non-Error thrown value to KAVO_UNEXPECTED_ERROR without throwing itself", () => {
    const shape = toKavoExceptionShape("just a string throw");
    expect(shape.code).toBe("KAVO_UNEXPECTED_ERROR");
    expect(shape.status).toBe(500);
    expect(shape.cause).toBe("just a string throw");
  });
});
