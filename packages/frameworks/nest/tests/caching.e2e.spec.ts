import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { KavoModuleOptions } from "@kavo/nest";
import { Kavo, KavoModule, parseEntityTags } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";
import { boundServer, listen, type SupertestTarget } from "./support/listen.js";

/**
 * ETag caching and conditional requests over real HTTP (issue #120,
 * ADR-0019). The engine-level semantics are pinned in
 * `packages/core/tests/caching.spec.ts`; what this file proves is the
 * wiring only `@kavo/nest` can: generated routes read `If-Match` /
 * `If-None-Match` off the request, set the `ETag` response header, and
 * turn a not-modified read into a bodyless `304` — with no hand-written
 * controller method anywhere.
 */

let app: INestApplication;
let adapter: InMemoryTodoAdapter;
let httpServer: SupertestTarget | undefined;

interface BootstrapOptions {
  readonly defaults?: KavoModuleOptions["defaults"];
  /**
   * Express sets a weak ETag of its own on any body it serializes, and
   * 304s a fresh `If-None-Match` against it — behavior that exists with or
   * without Kavo. Every test here turns it off, so an observed `ETag` or
   * `304` can only be Kavo's; the one test that leaves it on is the one
   * asserting Kavo's tag wins over it.
   */
  readonly expressEtag?: boolean;
}

async function bootstrap(controller: unknown, options: BootstrapOptions = {}): Promise<void> {
  adapter = new InMemoryTodoAdapter();
  const moduleRef = await Test.createTestingModule({
    imports: [
      KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter), defaults: options.defaults }),
      KavoModule.forFeature([controller as never]),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  (app.getHttpAdapter().getInstance() as { set(setting: string, value: unknown): void }).set(
    "etag",
    options.expressEtag ?? false,
  );
  httpServer = await listen(app);
}

afterEach(async () => {
  httpServer = undefined;
  await app.close();
});

function server(): SupertestTarget {
  return boundServer(httpServer);
}

/** Seed one todo and hand back the `ETag` its own creation response carried. */
async function seed(title = "write docs"): Promise<string> {
  const created = await request(server()).post("/todos").send({ title }).expect(201);
  return created.headers["etag"] as string;
}

@Kavo(Todo, { operations: { restoreOne: true } })
@Controller("todos")
class CachedTodoController {}

describe("ETag header on generated routes", () => {
  beforeEach(async () => {
    await bootstrap(CachedTodoController);
  });

  it("sets a strong ETag on every single-item response", async () => {
    const created = await request(server()).post("/todos").send({ title: "a" }).expect(201);
    expect(created.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);

    for (const response of [
      await request(server()).get("/todos/1").expect(200),
      await request(server()).put("/todos/1").send({ title: "b" }).expect(200),
      await request(server()).patch("/todos/1").send({ priority: 3 }).expect(200),
    ]) {
      expect(response.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
    }
  });

  it("sets one on a restoreOne response too", async () => {
    await request(server()).post("/todos").send({ title: "a" }).expect(201);
    await request(server()).delete("/todos/1").expect(204);

    const restored = await request(server()).patch("/todos/1/restore").expect(200);
    expect(restored.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("sets none on a collection or a bodyless delete", async () => {
    await request(server()).post("/todos").send({ title: "a" }).expect(201);

    expect((await request(server()).get("/todos").expect(200)).headers["etag"]).toBeUndefined();
    expect((await request(server()).delete("/todos/1").expect(204)).headers["etag"]).toBeUndefined();
  });

  it("still returns the ordinary body and status for every generated route", async () => {
    // The interceptor unwraps the engine envelope; nothing downstream may
    // ever see `{ operation, item, list, … }` on the wire.
    const created = await request(server()).post("/todos").send({ title: "a" }).expect(201);
    expect(created.body).toMatchObject({ id: 1, title: "a" });

    const list = await request(server()).get("/todos").expect(200);
    expect(list.body).toMatchObject({ items: [{ title: "a" }], limit: 20, offset: 0, total: 1 });

    const found = await request(server()).get("/todos/1").expect(200);
    expect(found.body).toMatchObject({ id: 1, title: "a" });
    expect(found.body).not.toHaveProperty("operation");
  });
});

describe("ETag alongside the host framework's own", () => {
  it("wins over Express's weak ETag", async () => {
    // Express tags whatever bytes it serializes; Kavo tags the
    // *representation*, which is what an `If-Match` is evaluated against
    // later. Ours is set first, and Express only fills in a tag that is
    // not already there.
    await bootstrap(CachedTodoController, { expressEtag: true });
    const created = await request(server()).post("/todos").send({ title: "a" }).expect(201);

    expect(created.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
  });
});

describe("If-None-Match → 304", () => {
  beforeEach(async () => {
    await bootstrap(CachedTodoController);
  });

  it("answers 304 with no body when the client's copy is current", async () => {
    const etag = await seed();

    const revalidated = await request(server()).get("/todos/1").set("If-None-Match", etag).expect(304);
    expect(revalidated.text).toBe("");
    expect(revalidated.body).toEqual({});
    expect(revalidated.headers["etag"]).toBe(etag);
  });

  it("answers 200 with a fresh ETag once the item has changed", async () => {
    const etag = await seed();
    await request(server()).patch("/todos/1").send({ priority: 9 }).expect(200);

    const revalidated = await request(server()).get("/todos/1").set("If-None-Match", etag).expect(200);
    expect(revalidated.body).toMatchObject({ priority: 9 });
    expect(revalidated.headers["etag"]).not.toBe(etag);
  });

  it("honors a list of candidate tags and the wildcard", async () => {
    const etag = await seed();

    await request(server()).get("/todos/1").set("If-None-Match", `"nope", ${etag}`).expect(304);
    await request(server()).get("/todos/1").set("If-None-Match", "*").expect(304);
    await request(server()).get("/todos/1").set("If-None-Match", '"nope"').expect(200);
  });

  it("leaves a collection read alone", async () => {
    const etag = await seed();
    await request(server()).get("/todos").set("If-None-Match", etag).expect(200);
  });
});

describe("If-Match → 412", () => {
  beforeEach(async () => {
    await bootstrap(CachedTodoController);
  });

  it("applies the write when the tag is current, returning a new ETag", async () => {
    const etag = await seed();

    const patched = await request(server())
      .patch("/todos/1")
      .set("If-Match", etag)
      .send({ title: "renamed" })
      .expect(200);
    expect(patched.body).toMatchObject({ title: "renamed" });
    expect(patched.headers["etag"]).not.toBe(etag);
  });

  it("rejects a stale tag with a 412 problem document and leaves the row untouched", async () => {
    const etag = await seed();
    await request(server()).patch("/todos/1").send({ priority: 5 }).expect(200);

    const rejected = await request(server())
      .patch("/todos/1")
      .set("If-Match", etag)
      .send({ title: "overwritten" })
      .expect(412);
    expect(rejected.headers["content-type"]).toContain("application/problem+json");
    expect(rejected.body).toMatchObject({ code: "KAVO_PRECONDITION_FAILED", status: 412 });

    const current = await request(server()).get("/todos/1").expect(200);
    expect(current.body).toMatchObject({ title: "write docs", priority: 5 });
  });

  it("blocks a stale PUT and a stale DELETE alike", async () => {
    const etag = await seed();
    await request(server()).patch("/todos/1").send({ priority: 5 }).expect(200);

    await request(server()).put("/todos/1").set("If-Match", etag).send({ title: "x" }).expect(412);
    await request(server()).delete("/todos/1").set("If-Match", etag).expect(412);
    expect(adapter.rows).toHaveLength(1);
  });

  it("allows a fresh DELETE", async () => {
    const etag = await seed();

    await request(server()).delete("/todos/1").set("If-Match", etag).expect(204);
    expect(adapter.rows.filter((row) => row.deletedAt === null)).toHaveLength(0);
  });

  it("404s a missing target rather than 412ing it", async () => {
    const response = await request(server()).patch("/todos/99").set("If-Match", '"anything"').send({ title: "x" });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "KAVO_NOT_FOUND" });
  });

  it("ignores If-Match on a request with no such header", async () => {
    await seed();
    await request(server()).patch("/todos/1").send({ priority: 1 }).expect(200);
  });
});

describe("caching.etag: false", () => {
  it("stops generating ETags when disabled globally", async () => {
    await bootstrap(CachedTodoController, { defaults: { caching: { etag: false } } });
    const created = await request(server()).post("/todos").send({ title: "a" }).expect(201);

    expect(created.headers["etag"]).toBeUndefined();
    expect((await request(server()).get("/todos/1").expect(200)).headers["etag"]).toBeUndefined();
  });

  it("ignores both conditional headers when disabled globally", async () => {
    // The tag Kavo *would* have issued for this exact row, captured from
    // an otherwise identical app — so the 200 below is the check being
    // skipped, not a tag that happened not to match.
    await bootstrap(CachedTodoController);
    const wouldBe = await seed("a");
    await app.close();

    await bootstrap(CachedTodoController, { defaults: { caching: { etag: false } } });
    await seed("a");

    await request(server()).get("/todos/1").set("If-None-Match", wouldBe).expect(200);
    await request(server()).patch("/todos/1").set("If-Match", '"definitely-stale"').send({ priority: 4 }).expect(200);
    expect(adapter.rows[0]).toMatchObject({ priority: 4 });
  });

  it("can be switched off for one entity only", async () => {
    @Kavo(Todo, { caching: { etag: false } })
    @Controller("todos")
    class UncachedTodoController {}
    await bootstrap(UncachedTodoController);

    const created = await request(server()).post("/todos").send({ title: "a" }).expect(201);
    expect(created.headers["etag"]).toBeUndefined();
  });

  it("can be switched off for one operation only", async () => {
    @Kavo(Todo, { operations: { findOne: { caching: { etag: false } } } })
    @Controller("todos")
    class PartiallyCachedTodoController {}
    await bootstrap(PartiallyCachedTodoController);

    const created = await request(server()).post("/todos").send({ title: "a" }).expect(201);
    expect(created.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
    expect((await request(server()).get("/todos/1").expect(200)).headers["etag"]).toBeUndefined();
  });
});

describe("parseEntityTags", () => {
  it("splits a header into whole entity-tags", () => {
    expect(parseEntityTags('"a", W/"b", *')).toEqual(['"a"', 'W/"b"', "*"]);
  });

  it("keeps a comma inside a quoted tag together", () => {
    expect(parseEntityTags('"a,b", "c"')).toEqual(['"a,b"', '"c"']);
  });

  it("joins a repeated header rather than picking one", () => {
    expect(parseEntityTags(['"a"', '"b"'])).toEqual(['"a"', '"b"']);
  });

  it("tolerates a non-conformant unquoted token instead of dropping it", () => {
    expect(parseEntityTags("abc")).toEqual(["abc"]);
  });

  it("stays absent when the header is absent, and for an empty value", () => {
    expect(parseEntityTags(undefined)).toBeUndefined();
    expect(parseEntityTags("")).toBeUndefined();
  });
});
