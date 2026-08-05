import { describe, expect, it } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { KavoExceptionFilter } from "../src/kavo-exception.filter.js";

/** A minimal stand-in for a non-HTTP `ArgumentsHost` (ws/rpc) — no real transport needed. */
function fakeNonHttpHost(type: "ws" | "rpc"): ArgumentsHost {
  return {
    getType: () => type,
    switchToHttp: () => {
      throw new Error("switchToHttp must never be called for a non-http context");
    },
  } as unknown as ArgumentsHost;
}

describe("KavoExceptionFilter — non-HTTP contexts", () => {
  it.each(["ws", "rpc"] as const)(
    "rethrows the original exception untouched for a %s context, without touching the response",
    (type) => {
      const filter = new KavoExceptionFilter();
      const original = new Error("microservice failure");
      expect(() => filter.catch(original, fakeNonHttpHost(type))).toThrow(original);
    },
  );
});
