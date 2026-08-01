import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Override } from "@kavo/nest";

// The reflect key is internal to @kavo/nest; read it back the same way
// kavo.decorator.ts does, via a tiny re-declaration, to keep this test
// black-box over the public `Override` decorator alone.
const KAVO_OVERRIDE_METADATA = "kavo:override";

describe("Override — method-decorator metadata (issue #23)", () => {
  it("defaults the operation id to the decorated method's own name", () => {
    class Controller {
      @Override()
      findOne(): void {}
    }
    expect(Reflect.getMetadata(KAVO_OVERRIDE_METADATA, Controller.prototype, "findOne")).toEqual({
      operationId: "findOne",
    });
  });

  it("uses an explicit operation id over the method name", () => {
    class Controller {
      @Override("createOne")
      customCreate(): void {}
    }
    expect(Reflect.getMetadata(KAVO_OVERRIDE_METADATA, Controller.prototype, "customCreate")).toEqual({
      operationId: "createOne",
    });
  });

  it("writes no metadata for an undecorated method", () => {
    class Controller {
      plain(): void {}
    }
    expect(Reflect.getMetadata(KAVO_OVERRIDE_METADATA, Controller.prototype, "plain")).toBeUndefined();
  });
});
