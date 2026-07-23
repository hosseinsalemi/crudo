import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";

/**
 * The Milestone B checkpoint (Phase 12): one entity served over HTTP by
 * the real stack — generated Nest routes → engine → TypeORM → SQLite —
 * with filtering, sorting, pagination, DTO projections, layered config,
 * and problem-details errors. This suite is the executable form of that
 * checkpoint, and this app seeds the Phase 18 reference application.
 */
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

function server(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

async function seed(): Promise<void> {
  const users = [
    { email: "ada@x.io", name: "Ada", age: 36 },
    { email: "grace@x.io", name: "Grace", age: 45 },
    { email: "alan@x.io", name: "Alan", age: 41 },
    { email: "joan@x.io", name: "Joan", age: 28 },
  ];
  for (const user of users) {
    await request(server()).post("/users").send(user).expect(201);
  }
}

describe("Milestone B checkpoint app", () => {
  it("runs the full CRUD lifecycle over HTTP", async () => {
    const created = await request(server())
      .post("/users")
      .send({ email: "first@x.io", name: "First", age: 30 })
      .expect(201);
    // Response is the UserItemDto projection.
    expect(created.body).toMatchObject({
      email: "first@x.io",
      name: "First",
      age: 30,
      status: "pending",
    });
    const id = created.body.id as number;

    const fetched = await request(server()).get(`/users/${id}`).expect(200);
    expect(Object.keys(fetched.body).sort()).toEqual(
      ["age", "createdAt", "email", "id", "name", "status"],
    );

    await request(server())
      .put(`/users/${id}`)
      .send({ email: "first@x.io", name: "Renamed", age: 31, status: "active" })
      .expect(200);

    const patched = await request(server())
      .patch(`/users/${id}`)
      .send({ age: 32 })
      .expect(200);
    expect(patched.body).toMatchObject({ name: "Renamed", age: 32 });

    await request(server()).delete(`/users/${id}`).expect(204);
    await request(server()).get(`/users/${id}`).expect(404);
  });

  it("filters, sorts, and paginates through the query grammar", async () => {
    await seed();
    const response = await request(server())
      .get("/users")
      .query("filter[age][gte]=30&sort=-age&limit=2&offset=1")
      .expect(200);

    // List responses use the leaner UserListDto projection.
    // Matches (age ≥ 30): Grace 45, Alan 41, Ada 36 — page starts at Alan.
    expect(response.body.items.map((u: { name: string }) => u.name)).toEqual([
      "Alan",
      "Ada",
    ]);
    expect(response.body.items[0]).not.toHaveProperty("age");
    expect(response.body).toMatchObject({ limit: 2, offset: 1, total: 3 });
  });

  it("supports OR groups and IN sets from the wire", async () => {
    const response = await request(server())
      .get("/users")
      .query(
        "filter[or][0][name][eq]=Ada&filter[or][1][name][eq]=Joan&sort=name",
      )
      .expect(200);
    expect(response.body.items.map((u: { name: string }) => u.name)).toEqual([
      "Ada",
      "Joan",
    ]);
  });

  it("applies sparse fieldsets after DTO mapping", async () => {
    const response = await request(server())
      .get("/users")
      .query("fields=id,name&sort=name&limit=1")
      .expect(200);
    expect(Object.keys(response.body.items[0])).toEqual(["id", "name"]);
  });

  it("honors the entity-scope pagination override (defaultLimit 10, max 50)", async () => {
    const defaulted = await request(server()).get("/users").expect(200);
    expect(defaulted.body.limit).toBe(10);
    const clamped = await request(server())
      .get("/users")
      .query("limit=500")
      .expect(200);
    expect(clamped.body.limit).toBe(50);
  });

  it("rejects bad queries with RFC 9457 problem details", async () => {
    const response = await request(server())
      .get("/users")
      .query("filter[password][eq]=x&filter[age][eq]=abc")
      .expect(400)
      .expect("Content-Type", /application\/problem\+json/);
    expect(response.body).toMatchObject({
      status: 400,
      code: "CRUDO_QUERY_INVALID",
      title: "Invalid query",
    });
    expect(response.body.errors).toEqual([
      expect.objectContaining({ field: "password", code: "CRUDO_QUERY_INVALID_FIELD" }),
      expect.objectContaining({ field: "age", code: "CRUDO_QUERY_INVALID_VALUE" }),
    ]);
  });

  it("rejects deferred features explicitly, never silently", async () => {
    const response = await request(server())
      .get("/users")
      .query("include=posts&withDeleted=true")
      .expect(400);
    expect(
      response.body.errors.map((e: { code: string }) => e.code),
    ).toEqual([
      "CRUDO_QUERY_UNSUPPORTED_PARAM",
      "CRUDO_QUERY_UNSUPPORTED_PARAM",
    ]);
  });

  it("maps unique violations to 409 conflict problem details", async () => {
    await request(server())
      .post("/users")
      .send({ email: "ada@x.io", name: "Duplicate", age: 1 })
      .expect(409)
      .expect("Content-Type", /application\/problem\+json/);
  });

  it("ignores client-sent generated columns", async () => {
    const created = await request(server())
      .post("/users")
      .send({ id: 4242, email: "gen@x.io", name: "Gen", age: 1 })
      .expect(201);
    expect(created.body.id).not.toBe(4242);
  });
});
