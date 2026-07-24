import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";

/**
 * The Pet example served by the real stack — generated Nest routes →
 * engine → TypeORM → SQLite — with filtering, sorting, pagination, DTO
 * projections, layered config, and problem-details errors. The schema
 * models single-table inheritance (Cat/Dog over one `pet` table) and an
 * Owner relation; crudo serves plain CRUD on each concrete entity, and
 * relation includes remain a deferred feature (asserted below).
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
  const cats = [
    { name: "Whiskers", age: 36, size: "small", indoor: true, livesLeft: 9 },
    { name: "Mittens", age: 45, size: "medium", indoor: false, livesLeft: 7 },
    { name: "Shadow", age: 41, size: "small", indoor: true, livesLeft: 8 },
    { name: "Tigger", age: 28, size: "large", indoor: false, livesLeft: 9 },
  ];
  for (const cat of cats) {
    await request(server()).post("/cats").send(cat).expect(201);
  }
}

describe("Pet example app", () => {
  it("runs the full CRUD lifecycle over HTTP", async () => {
    const created = await request(server())
      .post("/cats")
      .send({ name: "First", age: 3, size: "small", indoor: true, livesLeft: 9 })
      .expect(201);
    // Response is the CatItemDto projection.
    expect(created.body).toMatchObject({
      name: "First",
      age: 3,
      size: "small",
      indoor: true,
      livesLeft: 9,
    });
    const id = created.body.id as number;

    const fetched = await request(server()).get(`/cats/${id}`).expect(200);
    expect(Object.keys(fetched.body).sort()).toEqual(["age", "createdAt", "id", "indoor", "livesLeft", "name", "size"]);

    await request(server())
      .put(`/cats/${id}`)
      .send({ name: "Renamed", age: 4, size: "large", indoor: false, livesLeft: 8 })
      .expect(200);

    // patchOne is disabled on CatController — no route generated.
    await request(server()).patch(`/cats/${id}`).send({ age: 5 }).expect(404);

    await request(server()).delete(`/cats/${id}`).expect(204);
    await request(server()).get(`/cats/${id}`).expect(404);
  });

  it("filters, sorts, and paginates through the query grammar", async () => {
    await seed();
    const response = await request(server())
      .get("/cats")
      .query("filter[age][gte]=30&sort=-age&limit=2&offset=1")
      .expect(200);

    // List responses use the leaner CatListDto projection.
    // Matches (age ≥ 30): Mittens 45, Shadow 41, Whiskers 36 — page starts at Shadow.
    expect(response.body.items.map((c: { name: string }) => c.name)).toEqual(["Shadow", "Whiskers"]);
    expect(response.body.items[0]).not.toHaveProperty("age");
    expect(response.body).toMatchObject({ limit: 2, offset: 1, total: 3 });
  });

  it("filters on the enum column", async () => {
    const response = await request(server()).get("/cats").query("filter[size][eq]=small&sort=name").expect(200);
    expect(response.body.items.map((c: { name: string }) => c.name)).toEqual(["Shadow", "Whiskers"]);
  });

  it("supports OR groups and IN sets from the wire", async () => {
    const response = await request(server())
      .get("/cats")
      .query("filter[or][0][name][eq]=Whiskers&filter[or][1][name][eq]=Tigger&sort=name")
      .expect(200);
    expect(response.body.items.map((c: { name: string }) => c.name)).toEqual(["Tigger", "Whiskers"]);
  });

  it("applies sparse fieldsets after DTO mapping", async () => {
    const response = await request(server()).get("/cats").query("fields=id,name&sort=name&limit=1").expect(200);
    expect(Object.keys(response.body.items[0])).toEqual(["id", "name"]);
  });

  it("honors the entity-scope pagination override (defaultLimit 10, max 50)", async () => {
    const defaulted = await request(server()).get("/cats").expect(200);
    expect(defaulted.body.limit).toBe(10);
    const clamped = await request(server()).get("/cats").query("limit=500").expect(200);
    expect(clamped.body.limit).toBe(50);
  });

  it("rejects bad queries with RFC 9457 problem details", async () => {
    const response = await request(server())
      .get("/cats")
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

  it("rejects unsupported params explicitly, never silently", async () => {
    // `include` is deferred to Phase 15; `withDeleted` is real but
    // meaningless here — cats are not soft-deletable, owners are.
    const response = await request(server()).get("/cats").query("include=owner&withDeleted=true").expect(400);
    expect(response.body.errors.map((e: { code: string }) => e.code)).toEqual([
      "CRUDO_QUERY_UNSUPPORTED_PARAM",
      "CRUDO_QUERY_UNSUPPORTED_PARAM",
    ]);
  });

  it("soft-deletes, restores, and purges owners (Phase 14)", async () => {
    const created = await request(server()).post("/owners").send({ name: "Rose", email: "rose@x.io" }).expect(201);
    const id = created.body.id as number;

    await request(server()).delete(`/owners/${id}`).expect(204);
    await request(server()).get(`/owners/${id}`).expect(404);
    const withDeleted = await request(server())
      .get("/owners")
      .query(`withDeleted=true&filter[id][eq]=${id}`)
      .expect(200);
    expect(withDeleted.body.items).toHaveLength(1);

    // A second delete is a state conflict, not a 404.
    await request(server())
      .delete(`/owners/${id}`)
      .expect(409)
      .expect("Content-Type", /application\/problem\+json/);

    const restored = await request(server()).patch(`/owners/${id}/restore`).expect(200);
    expect(restored.body).toMatchObject({ id, name: "Rose" });
    await request(server()).get(`/owners/${id}`).expect(200);

    // Purge takes a soft-deleted row only.
    await request(server()).delete(`/owners/${id}/purge`).expect(409);
    await request(server()).delete(`/owners/${id}`).expect(204);
    await request(server()).delete(`/owners/${id}/purge`).expect(204);
    await request(server()).patch(`/owners/${id}/restore`).expect(404);
  });

  it("leaves hard-delete entities without restore or purge routes", async () => {
    const cat = await request(server())
      .post("/cats")
      .send({ name: "Ghost", age: 1, indoor: true, livesLeft: 9 })
      .expect(201);
    await request(server()).patch(`/cats/${cat.body.id}/restore`).expect(404);
    await request(server()).delete(`/cats/${cat.body.id}/purge`).expect(404);
  });

  it("maps unique violations to 409 conflict problem details", async () => {
    await request(server()).post("/owners").send({ name: "Ada", email: "ada@x.io" }).expect(201);
    await request(server())
      .post("/owners")
      .send({ name: "Duplicate", email: "ada@x.io" })
      .expect(409)
      .expect("Content-Type", /application\/problem\+json/);
  });

  it("round-trips the nullable startedAt date on owners", async () => {
    const withDate = await request(server())
      .post("/owners")
      .send({ name: "Grace", email: "grace@x.io", startedAt: "2020-01-15T00:00:00.000Z" })
      .expect(201);
    expect(new Date(withDate.body.startedAt as string).toISOString()).toBe("2020-01-15T00:00:00.000Z");

    const withoutDate = await request(server()).post("/owners").send({ name: "Alan", email: "alan@x.io" }).expect(201);
    expect(withoutDate.body.startedAt).toBeNull();
  });

  it("ignores client-sent generated columns", async () => {
    const created = await request(server())
      .post("/cats")
      .send({ id: 4242, name: "Gen", age: 1, indoor: true, livesLeft: 9 })
      .expect(201);
    expect(created.body.id).not.toBe(4242);
  });

  it("scopes each route to its subtype via the discriminator", async () => {
    const cat = await request(server())
      .post("/cats")
      .send({ name: "Felix", age: 2, indoor: true, livesLeft: 9 })
      .expect(201);
    const dog = await request(server())
      .post("/dogs")
      .send({ name: "Rex", age: 4, breed: "Labrador", goodBoy: true })
      .expect(201);

    const cats = await request(server()).get("/cats").query("limit=50").expect(200);
    const catNames = cats.body.items.map((c: { name: string }) => c.name);
    expect(catNames).toContain("Felix");
    expect(catNames).not.toContain("Rex");

    const dogs = await request(server()).get("/dogs").query("limit=50").expect(200);
    const dogNames = dogs.body.items.map((d: { name: string }) => d.name);
    expect(dogNames).toEqual(["Rex"]);

    // Each route reads back only its own subtype's row.
    await request(server()).get(`/cats/${cat.body.id}`).expect(200);
    await request(server()).get(`/dogs/${dog.body.id}`).expect(200);
  });

  it("documents the size enum and the owner pets oneOf in the OpenAPI schema", () => {
    type Schema = {
      type?: string;
      properties?: Record<string, Schema>;
      items?: Schema;
      enum?: readonly string[];
      example?: string;
      oneOf?: readonly { title?: string }[];
    };
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("t").setVersion("0").build());

    const catBody = (
      document.paths["/cats"] as { post?: { requestBody?: { content?: Record<string, { schema?: Schema }> } } }
    )?.post?.requestBody?.content?.["application/json"]?.schema;
    expect(catBody?.properties?.size).toEqual({
      type: "string",
      enum: ["small", "medium", "large"],
      example: "medium",
    });

    const ownerItem = (
      document.paths["/owners/{id}"] as Record<
        string,
        { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
      >
    )?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
    const pets = ownerItem?.properties?.pets;
    expect(pets?.type).toBe("array");
    expect(pets?.items?.oneOf?.map((variant) => variant.title)).toEqual(["CatItemDto", "DogItemDto"]);
  });
});
