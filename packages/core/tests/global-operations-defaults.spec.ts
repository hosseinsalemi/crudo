import { describe, expect, it } from "vitest";
import { ConfigurationException, OperationDisabledException, createKavo } from "@kavo/core";
import { InMemoryUserAdapter, User, userMetadata } from "./support/user-fixture.js";

/**
 * End-to-end coverage for `KavoSettings.operations` (issue #38): a global
 * default set via `createKavo({ defaults: { operations } })` reaches the
 * engine through `resolveEntityConfig` → `createOperationRegistry`, with
 * entity-level `operations` still winning where it's set.
 */
function makeCrud(globalOperations: Record<string, boolean>, entityConfig?: Record<string, unknown>) {
  const adapter = new InMemoryUserAdapter();
  const crud = createKavo({ defaults: { operations: globalOperations } }).createCrud(User, entityConfig as never, {
    adapter,
    metadata: userMetadata,
  });
  return { crud, adapter };
}

describe("global operations default — end to end (issue #38)", () => {
  it("disables an operation for every entity that doesn't override it", async () => {
    const { crud } = makeCrud({ deleteOne: false });
    await expect(crud.deleteOne(1)).rejects.toBeInstanceOf(OperationDisabledException);
  });

  it("still allows an entity that explicitly re-enables it", async () => {
    const { crud, adapter } = makeCrud({ deleteOne: false }, { operations: { deleteOne: true } });
    adapter.rows.push(Object.assign(new User(), { id: 1 }));
    await expect(crud.deleteOne(1)).resolves.toBeUndefined();
  });

  it("does not silently force-enable restoreOne on a hard-delete entity", () => {
    // User's fixture metadata carries no delete-marker field, so it
    // resolves to hard delete — a global force-enable must fail loudly at
    // bootstrap, not silently no-op or succeed (ADR-0013).
    expect(() => makeCrud({ restoreOne: true })).toThrow(ConfigurationException);
  });

  it("leaves an operation the global default didn't mention at its built-in default", async () => {
    const { crud } = makeCrud({ deleteOne: false });
    const created = await crud.createOne({
      name: "Ada",
      email: "ada@example.com",
      age: 30,
      status: "active",
    } as never);
    expect(created).toMatchObject({ name: "Ada" });
  });
});
