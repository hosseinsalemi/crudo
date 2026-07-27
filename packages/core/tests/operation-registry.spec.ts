import { describe, expect, it } from "vitest";
import type {
  EntityConfig,
  OperationDescriptor,
  OperationHandler,
  OperationMetadata,
  StandardOperationId,
} from "@kavo/core";
import {
  ConfigurationException,
  DefaultOperationRegistry,
  STANDARD_OPERATIONS,
  createOperationRegistry,
} from "@kavo/core";
import { User, contextStub } from "./support/user-fixture.js";

type UserConfig = EntityConfig<User>;

/** A handler identifiable by what it resolves to, so swaps are visible. */
function handlerNamed(name: string): OperationHandler<User> {
  return {
    async execute() {
      return name;
    },
  };
}

/** Binds every standard id to a distinguishable handler. */
const standardHandlers = (id: StandardOperationId): OperationHandler<User> => handlerNamed(`built-in:${id}`);

function descriptor(overrides: Partial<OperationDescriptor<User>> = {}): OperationDescriptor<User> {
  return {
    id: "activate",
    kind: "write",
    cardinality: "one",
    enabled: true,
    handler: handlerNamed("original"),
    input: null,
    output: null,
    meta: {},
    ...overrides,
  };
}

function ids(registry: { all(): readonly OperationDescriptor<User>[] }): string[] {
  return registry.all().map((entry) => entry.id);
}

describe("DefaultOperationRegistry — the operation table (Phase 7, ADR-0006)", () => {
  it("registers, looks up, and reports membership by id", () => {
    const registry = new DefaultOperationRegistry<User>();
    expect(registry.has("activate")).toBe(false);
    expect(registry.get("activate")).toBeUndefined();

    const entry = descriptor();
    registry.register(entry);
    expect(registry.has("activate")).toBe(true);
    expect(registry.get("activate")).toEqual(entry);
  });

  it("returns every entry in registration order", () => {
    const registry = new DefaultOperationRegistry<User>();
    for (const id of ["gamma", "alpha", "beta"]) registry.register(descriptor({ id }));
    expect(ids(registry)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("replaces only the handler, keeping the rest of the descriptor", () => {
    class ActivateUserDto {}
    class UserItemDto {}
    const registry = new DefaultOperationRegistry<User>();
    const meta: OperationMetadata = {};
    const original = descriptor({ kind: "read", input: ActivateUserDto, output: UserItemDto, meta });
    registry.register(original);

    const replacement = handlerNamed("override");
    registry.replace("activate", replacement);

    expect(registry.get("activate")).toEqual({ ...original, handler: replacement });
    expect(registry.get("activate")?.meta).toBe(meta);
  });

  it("keeps a disabled entry in the table, handler and all", () => {
    // Disabled entries stay so tooling can report them; they simply never
    // execute and generate no route.
    const registry = new DefaultOperationRegistry<User>();
    const original = descriptor();
    registry.register(original);

    registry.disable("activate");

    expect(registry.has("activate")).toBe(true);
    expect(ids(registry)).toEqual(["activate"]);
    expect(registry.get("activate")).toEqual({ ...original, enabled: false });
    expect(registry.get("activate")?.handler).toBe(original.handler);
  });

  it("refuses to override or disable an id nobody registered", () => {
    const registry = new DefaultOperationRegistry<User>();
    for (const act of [() => registry.replace("ghost", handlerNamed("x")), () => registry.disable("ghost")]) {
      try {
        act();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationException);
        expect(error).toMatchObject({
          code: "KAVO_CONFIG_INVALID",
          messageParams: { path: "operations.ghost" },
        });
      }
    }
  });
});

describe("STANDARD_OPERATIONS — the default table (Phases 7, 14)", () => {
  it("names one entry per standard operation, cardinality spelled out", () => {
    expect(Object.keys(STANDARD_OPERATIONS)).toEqual([
      "createOne",
      "findOne",
      "findMany",
      "updateOne",
      "patchOne",
      "deleteOne",
      "restoreOne",
      "purgeOne",
    ]);
  });

  it("turns the CRUD surface on by default", () => {
    const on = Object.entries(STANDARD_OPERATIONS)
      .filter(([, shape]) => shape.enabled)
      .map(([id]) => id);
    expect(on).toEqual(["createOne", "findOne", "findMany", "updateOne", "patchOne", "deleteOne"]);
  });

  it("keeps the soft-delete operations off and marks why (ADR-0013)", () => {
    for (const id of ["restoreOne", "purgeOne"] as const) {
      expect(STANDARD_OPERATIONS[id]).toMatchObject({ enabled: false, requiresSoftDelete: true });
    }
  });

  it("classifies reads and writes, and the one many-cardinality operation", () => {
    const reads = Object.entries(STANDARD_OPERATIONS)
      .filter(([, shape]) => shape.kind === "read")
      .map(([id]) => id);
    expect(reads).toEqual(["findOne", "findMany"]);

    const many = Object.entries(STANDARD_OPERATIONS)
      .filter(([, shape]) => shape.cardinality === "many")
      .map(([id]) => id);
    expect(many).toEqual(["findMany"]);
  });
});

describe("createOperationRegistry — default entries (Phase 7)", () => {
  it("registers the whole standard table, in table order", () => {
    const registry = createOperationRegistry<User>(undefined, standardHandlers);
    expect(ids(registry)).toEqual(Object.keys(STANDARD_OPERATIONS));
  });

  it("binds the built-in handler and leaves both DTO slots to the Phase 4 defaults", async () => {
    const registry = createOperationRegistry<User>(undefined, standardHandlers);
    const entry = registry.get("findOne");
    expect(entry).toMatchObject({ kind: "read", cardinality: "one", enabled: true, input: null, output: null });
    expect(entry?.meta).toEqual({});
    await expect(entry?.handler.execute(1, contextStub())).resolves.toBe("built-in:findOne");
  });
});

describe("createOperationRegistry — inspection-only mode (ADR-0012)", () => {
  it("still exposes the full table when no handlers are bound", () => {
    // Route generation runs at decoration time, where no engine exists.
    const registry = createOperationRegistry<User>(undefined);
    expect(ids(registry)).toEqual(Object.keys(STANDARD_OPERATIONS));
    expect(registry.get("findMany")).toMatchObject({ kind: "read", cardinality: "many", enabled: true });
  });

  it("refuses to execute an unbound entry, naming the operation", async () => {
    const registry = createOperationRegistry<User>(undefined);
    const handler = registry.get("createOne")?.handler;
    await expect(async () => handler?.execute({}, contextStub())).rejects.toMatchObject({
      code: "KAVO_CONFIG_INVALID",
      messageParams: { path: "operations.createOne" },
    });
    await expect(async () => handler?.execute({}, contextStub())).rejects.toBeInstanceOf(ConfigurationException);
  });
});

describe("createOperationRegistry — Phase 13 control surface", () => {
  it("disables an operation with the `false` shorthand, keeping its entry", () => {
    const registry = createOperationRegistry<User>({ operations: { patchOne: false } } as UserConfig, standardHandlers);
    expect(ids(registry)).toEqual(Object.keys(STANDARD_OPERATIONS));
    expect(registry.get("patchOne")).toMatchObject({ enabled: false });
    expect(registry.get("patchOne")?.handler).toBeDefined();
  });

  it("enables an off-by-default operation with the `true` shorthand", () => {
    const registry = createOperationRegistry<User>({ operations: { purgeOne: true } } as UserConfig, standardHandlers);
    expect(registry.get("purgeOne")?.enabled).toBe(true);
  });

  it("accepts the long `{ enabled }` form for both directions", () => {
    const registry = createOperationRegistry<User>(
      { operations: { restoreOne: { enabled: true }, deleteOne: { enabled: false } } } as UserConfig,
      standardHandlers,
    );
    expect(registry.get("restoreOne")?.enabled).toBe(true);
    expect(registry.get("deleteOne")?.enabled).toBe(false);
  });

  it("swaps the handler of an overridden operation, keeping its scaffolding", async () => {
    const override = handlerNamed("custom-update");
    const registry = createOperationRegistry<User>(
      { operations: { updateOne: { handler: override } } } as UserConfig,
      standardHandlers,
    );
    const entry = registry.get("updateOne");
    expect(entry).toMatchObject({ kind: "write", cardinality: "one", enabled: true, input: null, output: null });
    await expect(entry?.handler.execute({}, contextStub())).resolves.toBe("custom-update");
  });

  it("does not enable an off-by-default operation just because it was overridden", () => {
    const registry = createOperationRegistry<User>(
      { operations: { purgeOne: { handler: handlerNamed("custom-purge") } } } as UserConfig,
      standardHandlers,
    );
    expect(registry.get("purgeOne")?.enabled).toBe(false);
  });

  it("stores per-operation meta verbatim for the framework layer", () => {
    const meta: OperationMetadata = {};
    const registry = createOperationRegistry<User>(
      { operations: { findMany: { meta } } } as UserConfig,
      standardHandlers,
    );
    expect(registry.get("findMany")?.meta).toBe(meta);
  });
});
