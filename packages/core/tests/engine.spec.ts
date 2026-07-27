import { describe, expect, it } from "vitest";
import { NotFoundException, OperationDisabledException, createKavo, toProblemDetails } from "@kavo/core";
import { InMemoryUserAdapter, User, userMetadata } from "./support/user-fixture.js";

function makeCrud(config?: Parameters<ReturnType<typeof createKavo>["createCrud"]>[1]) {
  const adapter = new InMemoryUserAdapter();
  const kavo = createKavo();
  const crud = kavo.createCrud(User, config as never, {
    adapter,
    metadata: userMetadata,
  });
  return { crud, adapter, kavo };
}

describe("CrudEngine pipeline (Phase 7)", () => {
  it("runs createOne → findOne → updateOne → patchOne → deleteOne", async () => {
    const { crud } = makeCrud();
    const created = await crud.createOne({
      name: "Ada",
      email: "ada@example.com",
      age: 36,
      status: "active",
    } as never);
    expect(created).toMatchObject({ id: 1, name: "Ada" });

    const found = await crud.findOne(1);
    expect(found).toMatchObject({ email: "ada@example.com" });

    const updated = await crud.updateOne(1, { name: "Ada Lovelace" } as never);
    expect(updated).toMatchObject({ name: "Ada Lovelace" });

    const patched = await crud.patchOne(1, { age: 37 } as never);
    expect(patched).toMatchObject({ age: 37 });

    await crud.deleteOne(1);
    await expect(crud.findOne(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("strips generated and unknown keys from write payloads", async () => {
    const { crud, adapter } = makeCrud();
    await crud.createOne({
      id: 999,
      name: "Eve",
      email: "eve@example.com",
      role: "admin",
    } as never);
    const row = adapter.rows[0]!;
    expect(row.id).toBe(1); // client-sent id ignored (generated column)
    expect((row as unknown as Record<string, unknown>)["role"]).toBeUndefined();
  });

  it("returns the ListResultDto envelope from findMany", async () => {
    const { crud } = makeCrud();
    for (let i = 0; i < 5; i++) {
      await crud.createOne({ name: `u${i}`, email: `u${i}@x.io`, age: 20 + i } as never);
    }
    const list = await crud.findMany({ limit: 2, offset: 1 });
    expect(list.items).toHaveLength(2);
    expect(list.limit).toBe(2);
    expect(list.offset).toBe(1);
    expect(list.total).toBe(5);
    expect(list.meta).toEqual({});
  });

  it("reports total: null when counting is disabled", async () => {
    const { crud } = makeCrud({ pagination: { count: false } } as never);
    await crud.createOne({ name: "x", email: "x@x.io", age: 1 } as never);
    const list = await crud.findMany();
    expect(list.total).toBeNull();
  });

  it("applies field selection after DTO mapping", async () => {
    const { crud } = makeCrud();
    await crud.createOne({ name: "Ada", email: "a@x.io", age: 36 } as never);
    const list = await crud.findMany({ fields: { root: ["id", "name"] } } as never);
    expect(Object.keys(list.items[0] as object)).toEqual(["id", "name"]);
  });

  it("serializes through a registered item DTO class", async () => {
    class UserItemDto {
      id = 0;
      name = "";
    }
    const { crud } = makeCrud({ dto: { item: UserItemDto } } as never);
    const created = await crud.createOne({ name: "Ada", email: "a@x.io", age: 36 } as never);
    expect(Object.keys(created as object)).toEqual(["id", "name"]);
  });

  it("honors per-call settings overrides without touching config", async () => {
    const { crud } = makeCrud();
    await crud.createOne({ name: "x", email: "x@x.io", age: 1 } as never);
    const uncounted = await crud.findMany(undefined, {
      settings: { pagination: { count: false } },
    });
    expect(uncounted.total).toBeNull();
    const counted = await crud.findMany();
    expect(counted.total).toBe(1);
  });

  it("raises OperationDisabledException for operations off by default", async () => {
    const { crud } = makeCrud();
    // `restoreOne` stays off until the entity config declares soft delete.
    await expect(crud.restoreOne(1)).rejects.toBeInstanceOf(OperationDisabledException);
  });

  it("raises OperationDisabledException for config-disabled operations", async () => {
    const { crud } = makeCrud({ operations: { deleteOne: false } } as never);
    await expect(crud.deleteOne(1)).rejects.toBeInstanceOf(OperationDisabledException);
  });

  it("dispatches overridden handlers through the same pipeline", async () => {
    const { crud } = makeCrud({
      operations: {
        findOne: {
          handler: {
            async execute() {
              return Object.assign(new User(), { id: 42, name: "override" });
            },
          },
        },
      },
    } as never);
    const found = await crud.findOne(42);
    expect(found).toMatchObject({ id: 42, name: "override" });
  });

  it("maps NotFound into a problem-details document", async () => {
    const { crud } = makeCrud();
    try {
      await crud.findOne(123);
      expect.unreachable();
    } catch (error) {
      const problem = toProblemDetails(error as never);
      expect(problem).toMatchObject({
        status: 404,
        code: "KAVO_NOT_FOUND",
        type: "https://kavo.dev/errors/kavo-not-found",
      });
      expect(problem.detail).toContain("123");
      expect(problem.instance).toMatch(/^urn:kavo:request:/);
    }
  });

  it("exposes the debug dump through kavo.describe", () => {
    const { kavo } = makeCrud();
    const dump = kavo.describe("User");
    expect(dump).toMatchObject({ entityName: "User" });
  });
});
