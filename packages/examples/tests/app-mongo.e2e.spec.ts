import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MongoAppModule } from "../src/mongo/mongo.module.js";

/**
 * The Blog example served by the real stack — `@Kavo`-generated NestJS
 * routes → CRUD engine → `@kavo/mongoose` → a real MongoDB.
 *
 * This is the only place all three packages are exercised together: the
 * adapter's own suites drive the engine directly, so nothing else proves
 * that route generation, DTO projection, the exception filter, and the
 * Mongoose adapter compose. It deliberately does *not* reuse
 * `crud-e2e.suite.ts`, which is written against the TypeORM app's numeric
 * `id` and single-table inheritance; a document store's `_id` string is a
 * different contract, and forking that suite's assertions would hide
 * exactly the difference worth showing.
 */
let server: MongoMemoryServer;
let app: INestApplication;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName: "kavo-examples" });

  const moduleRef = await Test.createTestingModule({
    imports: [MongoAppModule.forRoot()],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 60_000);

afterAll(async () => {
  if (app !== undefined) await app.close();
  await mongoose.disconnect();
  if (server !== undefined) await server.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.deleteMany({})));
});

function http(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

async function newAuthor(email = "ada@x.io"): Promise<string> {
  const created = await request(http()).post("/authors").send({ name: "Ada", email }).expect(201);
  return created.body._id as string;
}

describe("Blog example app (Mongoose)", () => {
  it("runs the full CRUD lifecycle over HTTP", async () => {
    const created = await request(http())
      .post("/articles")
      .send({ title: "First", body: "hello", tags: ["intro"] })
      .expect(201);
    // Response is the ArticleItemDto projection, keyed by `_id`.
    expect(created.body).toMatchObject({ title: "First", body: "hello", status: "draft", tags: ["intro"] });
    expect(created.body._id).toMatch(/^[0-9a-f]{24}$/);
    const id = created.body._id as string;

    const fetched = await request(http()).get(`/articles/${id}`).expect(200);
    expect(Object.keys(fetched.body).sort()).toEqual(["_id", "body", "createdAt", "status", "tags", "title"]);

    await request(http()).put(`/articles/${id}`).send({ title: "Renamed", status: "published" }).expect(200);
    const patched = await request(http()).patch(`/articles/${id}`).send({ body: "edited" }).expect(200);
    expect(patched.body).toMatchObject({ title: "Renamed", status: "published", body: "edited" });

    await request(http()).delete(`/articles/${id}`).expect(204);
    await request(http()).get(`/articles/${id}`).expect(404);
  });

  it("serves the leaner list projection with the pagination envelope", async () => {
    for (const title of ["A", "B", "C"]) {
      await request(http()).post("/articles").send({ title, body: "x" }).expect(201);
    }
    const list = await request(http()).get("/articles?limit=2&offset=0&sort=title").expect(200);

    expect(list.body).toMatchObject({ limit: 2, offset: 0, total: 3 });
    expect(list.body.items.map((item: { title: string }) => item.title)).toEqual(["A", "B"]);
    // ArticleListDto omits `body` and `createdAt`, which `item` carries.
    expect(Object.keys(list.body.items[0]).sort()).toEqual(["_id", "status", "tags", "title"]);
  });

  it("filters and sorts through the wire grammar", async () => {
    await request(http()).post("/articles").send({ title: "Draft one", status: "draft" }).expect(201);
    await request(http()).post("/articles").send({ title: "Published one", status: "published" }).expect(201);

    const filtered = await request(http()).get("/articles?filter[status][eq]=published").expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].title).toBe("Published one");

    // LIKE is translated to an anchored, fully escaped $regex.
    const liked = await request(http()).get("/articles?filter[title][like]=Draft%25").expect(200);
    expect(liked.body.items.map((item: { title: string }) => item.title)).toEqual(["Draft one"]);
  });

  it("embeds a relation with include, and filters by the reference id", async () => {
    const authorId = await newAuthor();
    await request(http()).post("/articles").send({ title: "Owned", author: authorId }).expect(201);
    await request(http()).post("/articles").send({ title: "Orphan" }).expect(201);

    const included = await request(http()).get("/articles?include=author&filter[title][eq]=Owned").expect(200);
    expect(included.body.items[0].author).toMatchObject({ _id: authorId, name: "Ada" });

    // A Mongoose `ref` path is the foreign key too, so it is filterable.
    const byAuthor = await request(http()).get(`/articles?filter[author][eq]=${authorId}`).expect(200);
    expect(byAuthor.body.items.map((item: { title: string }) => item.title)).toEqual(["Owned"]);
  });

  it("soft-deletes, hides, restores, and purges", async () => {
    const created = await request(http()).post("/articles").send({ title: "Temporary" }).expect(201);
    const id = created.body._id as string;

    await request(http()).delete(`/articles/${id}`).expect(204);
    expect((await request(http()).get("/articles").expect(200)).body.total).toBe(0);
    expect((await request(http()).get("/articles?withDeleted=true").expect(200)).body.total).toBe(1);
    // Deleting twice is a state conflict, not a missing document.
    await request(http()).delete(`/articles/${id}`).expect(409);

    // `restoreOne` exists because the controller *declares* soft delete.
    const restored = await request(http()).patch(`/articles/${id}/restore`).expect(200);
    expect(restored.body).toMatchObject({ _id: id, title: "Temporary" });
    expect((await request(http()).get("/articles").expect(200)).body.total).toBe(1);

    // Purge only ever removes an already-deleted document.
    await request(http()).delete(`/articles/${id}/purge`).expect(409);
    await request(http()).delete(`/articles/${id}`).expect(204);
    await request(http()).delete(`/articles/${id}/purge`).expect(204);
    expect((await request(http()).get("/articles?withDeleted=true").expect(200)).body.total).toBe(0);
    await request(http()).patch(`/articles/${id}/restore`).expect(404);
  });

  it("answers a malformed id with 404 and a bad query with problem details", async () => {
    const missing = await request(http()).get("/articles/not-an-objectid").expect(404);
    expect(missing.body).toMatchObject({ code: "KAVO_NOT_FOUND", status: 404 });

    // A filter on a field that is not allowlisted is a 400 with issues[].
    const invalid = await request(http()).get("/articles?filter[body][eq]=x").expect(400);
    expect(invalid.body).toMatchObject({ code: "KAVO_QUERY_INVALID", status: 400 });
    expect(invalid.body.errors[0]).toMatchObject({ field: "body" });
  });

  it("refuses a relation-path filter instead of silently matching nothing", async () => {
    // MongoDB resolves a dotted path inside a document, never across a
    // `ref`, so this is refused rather than quietly returning [].
    const refused = await request(http()).get("/articles?filter[author.name][eq]=Ada").expect(400);
    expect(refused.body).toMatchObject({ code: "KAVO_QUERY_INVALID" });
  });

  it("serves the zero-config Author routes with derived defaults", async () => {
    const authorId = await newAuthor("grace@x.io");
    const fetched = await request(http()).get(`/authors/${authorId}`).expect(200);
    expect(fetched.body).toMatchObject({ _id: authorId, name: "Ada", email: "grace@x.io" });
    // Mongoose's `__v` bookkeeping never reaches the wire.
    expect(fetched.body).not.toHaveProperty("__v");

    // `_id`/`createdAt`/`updatedAt` are generated, so they are not writable.
    const created = await request(http())
      .post("/authors")
      .send({ _id: "507f1f77bcf86cd799439011", name: "Alan", email: "alan@x.io" })
      .expect(201);
    expect(created.body._id).not.toBe("507f1f77bcf86cd799439011");
  });
});
