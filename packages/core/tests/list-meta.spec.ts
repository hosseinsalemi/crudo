import { describe, expect, it } from "vitest";
import type { FindManyResult, KavoContext, ListMetaDto, OperationHandler } from "@kavo/core";
import { ConfigurationException, builtInHandlers, createKavo, withListMeta } from "@kavo/core";
import { InMemoryUserAdapter, User, userMetadata } from "./support/user-fixture.js";

/**
 * `ListResultDto.meta` — the list envelope's open metadata bag (issue
 * #122). Not `OperationConfig.meta`/`OperationMetadata` (ADR-0007), which
 * is route metadata on a registry entry and never reaches a response.
 *
 * The seam is deliberately plain: the `findMany` handler returns `meta`
 * alongside `entities`/`total`, and the engine merges it into the envelope
 * instead of discarding it. No new config key — `operations.findMany.handler`
 * already exists (ADR-0006), so this suite drives the real registry
 * override path rather than reaching into the engine.
 */

function makeCrud(config?: Parameters<ReturnType<typeof createKavo>["createCrud"]>[1]) {
  const adapter = new InMemoryUserAdapter();
  const crud = createKavo().createCrud(User, config as never, { adapter, metadata: userMetadata });
  return { crud, adapter };
}

/** A `findMany` handler that ignores the adapter and answers verbatim. */
function fixedHandler(result: FindManyResult<User>): OperationHandler<User, unknown, FindManyResult<User>> {
  return {
    async execute() {
      return result;
    },
  };
}

/** Config that swaps in `handler` for `findMany`, nothing else. */
function findManyHandler(handler: OperationHandler<User, unknown, unknown>) {
  return { operations: { findMany: { handler } } } as never;
}

const ADA = { name: "Ada", email: "ada@example.com", age: 36 };

describe("ListResultDto.meta — the handler's contribution reaches the envelope", () => {
  it("is an empty bag when the built-in handler contributes nothing", async () => {
    const { crud } = makeCrud();
    await crud.createOne(ADA as never);

    const list = await crud.findMany();
    expect(list.meta).toEqual({});
  });

  it("carries a handler's meta onto the envelope", async () => {
    const { crud } = makeCrud(findManyHandler(fixedHandler({ entities: [], total: 0, meta: { generatedIn: "3ms" } })));

    const list = await crud.findMany();
    expect(list.meta).toEqual({ generatedIn: "3ms" });
  });

  it("reaches the envelope verbatim for arbitrary JSON-serializable shapes", async () => {
    // `meta` is the caller's own data, not entity data: it never passes
    // through the serializer, so nothing narrows, reorders, or coerces it.
    const bag: ListMetaDto = {
      facets: { status: { active: 2, banned: 1 } },
      appliedFilters: ["status", "age"],
      cursor: null,
      exhausted: false,
      queriedAt: 1700000000000,
    };
    const { crud } = makeCrud(findManyHandler(fixedHandler({ entities: [], total: 0, meta: bag })));

    const list = await crud.findMany();
    expect(list.meta).toEqual(bag);
  });

  it("leaves meta whole when field selection narrows the items", async () => {
    const { crud } = makeCrud(findManyHandler(fixedHandler({ entities: [], total: 0, meta: { keep: { me: true } } })));

    const list = await crud.findMany({ fields: { root: ["id"] } } as never);
    expect(list.meta).toEqual({ keep: { me: true } });
  });

  it("still yields an empty bag when a custom handler omits meta entirely", async () => {
    const { crud } = makeCrud(findManyHandler(fixedHandler({ entities: [], total: 7 })));

    const list = await crud.findMany();
    expect(list.meta).toEqual({});
    expect(list.total).toBe(7);
  });
});

describe("withListMeta — wrapping a findMany handler to add envelope metadata", () => {
  /** Wraps the built-in `findMany`, the documented main path. */
  function wrapBuiltIn(
    compute: (result: FindManyResult<User>, context: KavoContext<User>) => ListMetaDto | Promise<ListMetaDto>,
  ) {
    const adapter = new InMemoryUserAdapter();
    const crud = createKavo().createCrud(
      User,
      findManyHandler(withListMeta<User>(builtInHandlers<User>(adapter)("findMany"), compute)),
      { adapter, metadata: userMetadata },
    );
    return { crud, adapter };
  }

  it("adds the contributor's keys without disturbing entities or total", async () => {
    const { crud } = wrapBuiltIn((result) => ({ oldest: Math.max(...result.entities.map((user) => user.age)) }));
    await crud.createOne(ADA as never);
    await crud.createOne({ name: "Grace", email: "grace@example.com", age: 45 } as never);

    const list = await crud.findMany();
    expect(list.items).toHaveLength(2);
    expect(list.total).toBe(2);
    expect(list.meta).toEqual({ oldest: 45 });
  });

  it("hands the contributor the real result and request context", async () => {
    let seen: { entityName: string; operation: string; total: number | null; rows: number } | null = null;
    const { crud } = wrapBuiltIn((result, context) => {
      seen = {
        entityName: context.entityName,
        operation: context.operation,
        total: result.total,
        rows: result.entities.length,
      };
      return {};
    });
    await crud.createOne(ADA as never);

    await crud.findMany();
    expect(seen).toEqual({ entityName: "User", operation: "findMany", total: 1, rows: 1 });
  });

  it("awaits an async contributor", async () => {
    const { crud } = wrapBuiltIn(async () => Promise.resolve({ computed: "async" }));

    const list = await crud.findMany();
    expect(list.meta).toEqual({ computed: "async" });
  });

  it("keeps the inner handler's meta keys the contributor does not name", async () => {
    const inner = fixedHandler({ entities: [], total: 0, meta: { fromInner: 1, shared: "inner" } });
    const { crud } = makeCrud(findManyHandler(withListMeta<User>(inner, () => ({ fromOuter: 2 }))));

    const list = await crud.findMany();
    expect(list.meta).toEqual({ fromInner: 1, shared: "inner", fromOuter: 2 });
  });

  it("gives the contributor precedence on a key both set", async () => {
    // Documented precedence: the outer, more specific decoration wins —
    // the same direction as global → entity → operation → per-call.
    const inner = fixedHandler({ entities: [], total: 0, meta: { shared: "inner" } });
    const { crud } = makeCrud(findManyHandler(withListMeta<User>(inner, () => ({ shared: "outer" }))));

    const list = await crud.findMany();
    expect(list.meta).toEqual({ shared: "outer" });
  });

  it("lets a contributor opt out of that precedence by spreading the inner bag last", async () => {
    const inner = fixedHandler({ entities: [], total: 0, meta: { shared: "inner" } });
    const { crud } = makeCrud(
      findManyHandler(withListMeta<User>(inner, (result) => ({ shared: "outer", ...result.meta }))),
    );

    const list = await crud.findMany();
    expect(list.meta).toEqual({ shared: "inner" });
  });

  it("layers nested wraps so the outermost owns a contested key", async () => {
    const inner = fixedHandler({ entities: [], total: 0, meta: { layer: "handler" } });
    const wrapped = withListMeta<User>(
      withListMeta<User>(inner, () => ({ layer: "middle", middleOnly: true })),
      () => ({ layer: "outer" }),
    );
    const { crud } = makeCrud(findManyHandler(wrapped));

    const list = await crud.findMany();
    expect(list.meta).toEqual({ layer: "outer", middleOnly: true });
  });

  it("leaves the inner bag untouched when the contributor returns nothing to add", async () => {
    const inner = fixedHandler({ entities: [], total: 0, meta: { fromInner: true } });
    const { crud } = makeCrud(findManyHandler(withListMeta<User>(inner, () => ({}))));

    const list = await crud.findMany();
    expect(list.meta).toEqual({ fromInner: true });
  });

  it("rejects a wrapped handler that is not findMany-shaped", async () => {
    // The parameter is typed as `OperationHandler<Entity>` so the wrap
    // composes with `builtInHandlers(...)` and `OperationConfig.handler`
    // without a cast — which erases the output type, so a wrong-shaped
    // inner handler has to be caught here rather than assembling a broken
    // envelope.
    const notAList = {
      async execute() {
        return Object.assign(new User(), { id: 1 });
      },
    };
    const { crud } = makeCrud(findManyHandler(withListMeta<User>(notAList, () => ({ never: "reached" }))));

    await expect(crud.findMany()).rejects.toBeInstanceOf(ConfigurationException);
    await expect(crud.findMany()).rejects.toMatchObject({
      code: "KAVO_CONFIG_INVALID",
      context: { entityName: "User" },
    });
    await expect(crud.findMany()).rejects.toThrow("operations.findMany.handler");
  });

  it("never runs the contributor when the wrapped handler is wrong-shaped", async () => {
    let ran = false;
    const notAList = {
      async execute() {
        return null;
      },
    };
    const { crud } = makeCrud(
      findManyHandler(
        withListMeta<User>(notAList, () => {
          ran = true;
          return {};
        }),
      ),
    );

    await expect(crud.findMany()).rejects.toBeInstanceOf(ConfigurationException);
    expect(ran).toBe(false);
  });
});
