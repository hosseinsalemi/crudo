import { describe, expect, it } from "vitest";
import type { KavoRequest, RequestPreconditions } from "@kavo/core";
import { NotFoundException, PreconditionFailedException, createKavo } from "@kavo/core";
import { InMemoryUserAdapter, User, userMetadata } from "./support/user-fixture.js";
import { Account, InMemoryAccountAdapter, accountMetadata } from "./support/account-fixture.js";

type EntityConfigArg = Parameters<ReturnType<typeof createKavo>["createCrud"]>[1];

function makeCrud(config?: EntityConfigArg, defaults?: Parameters<typeof createKavo>[0]) {
  const adapter = new InMemoryUserAdapter();
  const crud = createKavo(defaults).createCrud(User, config as never, { adapter, metadata: userMetadata });
  return { crud, adapter };
}

function makeAccountCrud(config?: EntityConfigArg) {
  const adapter = new InMemoryAccountAdapter();
  const crud = createKavo().createCrud(Account, config as never, { adapter, metadata: accountMetadata });
  return { crud, adapter };
}

const ADA = { name: "Ada", email: "ada@example.com", age: 36, status: "active" } as const;

/** The engine envelope, which the typed service surface unwraps away. */
function execute(
  crud: ReturnType<typeof makeCrud>["crud"],
  request: Partial<KavoRequest<User>> & { operation: string },
) {
  return crud.engine.execute({ id: null, body: null, query: null, options: null, ...request } as never);
}

describe("ETag generation", () => {
  it("puts a strong entity-tag on every single-item response", async () => {
    const { crud } = makeCrud();
    for (const response of [
      await execute(crud, { operation: "createOne", body: ADA as never }),
      await execute(crud, { operation: "findOne", id: 1 }),
      await execute(crud, { operation: "updateOne", id: 1, body: { name: "Ada L" } as never }),
      await execute(crud, { operation: "patchOne", id: 1, body: { age: 37 } as never }),
    ]) {
      expect(response.etag).toMatch(/^"[0-9a-f]{64}"$/);
      expect(response.notModified).toBe(false);
    }
  });

  it("tags a restoreOne response too", async () => {
    const { crud } = makeAccountCrud({ operations: { restoreOne: true } });
    await crud.createOne({ name: "a" } as never);
    await crud.deleteOne(1);

    const response = await crud.engine.execute({
      operation: "restoreOne",
      id: 1,
      body: null,
      query: null,
      options: null,
    } as never);
    expect(response.etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("changes the tag when the item changes and repeats it when it does not", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });
    const first = await execute(crud, { operation: "findOne", id: 1 });
    const again = await execute(crud, { operation: "findOne", id: 1 });
    expect(again.etag).toBe(first.etag);

    await execute(crud, { operation: "patchOne", id: 1, body: { age: 99 } as never });
    const changed = await execute(crud, { operation: "findOne", id: 1 });
    expect(changed.etag).not.toBe(first.etag);
  });

  it("leaves collection and void responses untagged (out of scope)", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });

    const list = await execute(crud, { operation: "findMany" });
    expect(list.etag).toBeNull();
    expect(list.notModified).toBe(false);

    const deleted = await execute(crud, { operation: "deleteOne", id: 1 });
    expect(deleted.etag).toBeNull();
  });

  it("tags per representation: a narrowed read is a different representation", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });

    const full = await execute(crud, { operation: "findOne", id: 1 });
    const narrowed = await execute(crud, { operation: "findOne", id: 1, query: { fields: ["name"] } as never });
    expect(narrowed.item).toEqual({ name: "Ada" });
    expect(narrowed.etag).not.toBe(full.etag);
  });
});

describe("If-None-Match on a read", () => {
  const ifNoneMatch = (tags: readonly string[]): RequestPreconditions => ({ ifNoneMatch: tags });

  it("signals not-modified when the client's tag is current", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });
    const { etag } = await execute(crud, { operation: "findOne", id: 1 });

    const revalidated = await execute(crud, {
      operation: "findOne",
      id: 1,
      preconditions: ifNoneMatch([etag as string]),
    });
    expect(revalidated.notModified).toBe(true);
    expect(revalidated.etag).toBe(etag);
  });

  it("does not signal not-modified once the item has changed", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });
    const { etag } = await execute(crud, { operation: "findOne", id: 1 });
    await execute(crud, { operation: "patchOne", id: 1, body: { age: 99 } as never });

    const revalidated = await execute(crud, {
      operation: "findOne",
      id: 1,
      preconditions: ifNoneMatch([etag as string]),
    });
    expect(revalidated.notModified).toBe(false);
    expect(revalidated.etag).not.toBe(etag);
    expect(revalidated.item).toMatchObject({ age: 99 });
  });

  it("matches the wildcard against any existing representation", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });

    const revalidated = await execute(crud, { operation: "findOne", id: 1, preconditions: ifNoneMatch(["*"]) });
    expect(revalidated.notModified).toBe(true);
  });

  it("is ignored on a write, which has no cache to revalidate", async () => {
    const { crud } = makeCrud();
    const created = await execute(crud, { operation: "createOne", body: ADA as never });

    const patched = await execute(crud, {
      operation: "patchOne",
      id: 1,
      body: { name: "Ada" } as never,
      preconditions: ifNoneMatch([created.etag as string, "*"]),
    });
    expect(patched.notModified).toBe(false);
  });
});

describe("If-Match on a write", () => {
  const ifMatch = (tags: readonly string[]): RequestPreconditions => ({ ifMatch: tags });

  async function seeded() {
    const made = makeCrud();
    await execute(made.crud, { operation: "createOne", body: ADA as never });
    const { etag } = await execute(made.crud, { operation: "findOne", id: 1 });
    return { ...made, etag: etag as string };
  }

  it("applies the write when the tag is current", async () => {
    const { crud, adapter, etag } = await seeded();

    const updated = await execute(crud, {
      operation: "updateOne",
      id: 1,
      body: { name: "Ada Lovelace", email: ADA.email, age: 36, status: "active" } as never,
      preconditions: ifMatch([etag]),
    });
    expect(updated.item).toMatchObject({ name: "Ada Lovelace" });
    expect(updated.etag).not.toBe(etag);
    expect(adapter.rows[0]).toMatchObject({ name: "Ada Lovelace" });
  });

  it("rejects a stale tag with KAVO_PRECONDITION_FAILED and leaves the row untouched", async () => {
    const { crud, adapter, etag } = await seeded();
    await execute(crud, { operation: "patchOne", id: 1, body: { age: 99 } as never });

    const attempt = execute(crud, {
      operation: "patchOne",
      id: 1,
      body: { name: "Overwritten" } as never,
      preconditions: ifMatch([etag]),
    });
    await expect(attempt).rejects.toBeInstanceOf(PreconditionFailedException);
    await expect(attempt).rejects.toMatchObject({ code: "KAVO_PRECONDITION_FAILED", status: 412 });
    expect(adapter.rows[0]).toMatchObject({ name: "Ada", age: 99 });
  });

  it("blocks a stale deleteOne, leaving the row in place", async () => {
    const { crud, adapter, etag } = await seeded();
    await execute(crud, { operation: "patchOne", id: 1, body: { age: 99 } as never });

    await expect(
      execute(crud, { operation: "deleteOne", id: 1, preconditions: ifMatch([etag]) }),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
    expect(adapter.rows).toHaveLength(1);
  });

  it("allows a fresh deleteOne", async () => {
    const { crud, adapter, etag } = await seeded();

    await execute(crud, { operation: "deleteOne", id: 1, preconditions: ifMatch([etag]) });
    expect(adapter.rows).toHaveLength(0);
  });

  it("raises 404, not 412, when the target does not exist", async () => {
    const { crud } = makeCrud();

    const attempt = execute(crud, {
      operation: "patchOne",
      id: 404,
      body: { name: "ghost" } as never,
      preconditions: ifMatch(['"whatever"']),
    });
    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toMatchObject({ code: "KAVO_NOT_FOUND", status: 404 });
  });

  it("names the current tag in the failure, so a client can retry without a blind re-GET", async () => {
    const { crud, etag } = await seeded();
    await execute(crud, { operation: "patchOne", id: 1, body: { age: 99 } as never });
    const current = (await execute(crud, { operation: "findOne", id: 1 })).etag as string;

    await expect(
      execute(crud, { operation: "patchOne", id: 1, body: { age: 1 } as never, preconditions: ifMatch([etag]) }),
    ).rejects.toMatchObject({ messageParams: { entity: "User", id: "1", etag: current } });
  });

  it("accepts the wildcard against an existing row", async () => {
    const { crud, adapter } = await seeded();

    await execute(crud, { operation: "patchOne", id: 1, body: { age: 42 } as never, preconditions: ifMatch(["*"]) });
    expect(adapter.rows[0]).toMatchObject({ age: 42 });
  });

  it("rejects a weak tag, which promises only semantic equivalence", async () => {
    const { crud, etag } = await seeded();

    await expect(
      execute(crud, { operation: "patchOne", id: 1, body: { age: 1 } as never, preconditions: ifMatch([`W/${etag}`]) }),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it("reaches the engine through KavoCallOptions on the typed service surface", async () => {
    const { crud, etag } = await seeded();

    await expect(
      crud.patchOne(1, { age: 1 } as never, { preconditions: { ifMatch: ['"stale"'] } }),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
    await expect(crud.patchOne(1, { age: 1 } as never, { preconditions: { ifMatch: [etag] } })).resolves.toMatchObject({
      age: 1,
    });
  });
});

describe("caching.etag: false disables both halves", () => {
  const scopes: readonly (readonly [string, () => ReturnType<typeof makeCrud>])[] = [
    ["global", () => makeCrud(undefined, { defaults: { caching: { etag: false } } })],
    ["entity", () => makeCrud({ caching: { etag: false } } as never)],
    [
      "operation",
      () =>
        makeCrud({
          operations: { findOne: { caching: { etag: false } }, patchOne: { caching: { etag: false } } },
        } as never),
    ],
  ];

  for (const [scope, build] of scopes) {
    it(`computes no tag at ${scope} scope`, async () => {
      const { crud } = build();
      await execute(crud, { operation: "createOne", body: ADA as never });

      expect((await execute(crud, { operation: "findOne", id: 1 })).etag).toBeNull();
    });

    it(`ignores an If-Match precondition at ${scope} scope`, async () => {
      const { crud, adapter } = build();
      await execute(crud, { operation: "createOne", body: ADA as never });

      await execute(crud, {
        operation: "patchOne",
        id: 1,
        body: { age: 7 } as never,
        preconditions: { ifMatch: ['"definitely-stale"'] },
      });
      expect(adapter.rows[0]).toMatchObject({ age: 7 });
    });
  }

  it("can be turned off for one call only, without touching the frozen config", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });

    const off = await execute(crud, {
      operation: "findOne",
      id: 1,
      options: { settings: { caching: { etag: false } } },
    });
    expect(off.etag).toBeNull();

    expect((await execute(crud, { operation: "findOne", id: 1 })).etag).not.toBeNull();
  });

  it("ignores an If-None-Match when switched off per call", async () => {
    const { crud } = makeCrud();
    await execute(crud, { operation: "createOne", body: ADA as never });
    const { etag } = await execute(crud, { operation: "findOne", id: 1 });

    const off = await execute(crud, {
      operation: "findOne",
      id: 1,
      preconditions: { ifNoneMatch: [etag as string] },
      options: { settings: { caching: { etag: false } } },
    });
    expect(off.notModified).toBe(false);
  });
});
