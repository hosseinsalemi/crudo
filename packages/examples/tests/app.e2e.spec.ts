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
 * Owner relation; crudo serves plain CRUD on each concrete entity, plus
 * opt-in relation includes in both directions (asserted below).
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

  it("rejects params that do not apply to this entity, never silently", async () => {
    // Cats are not soft-deletable (owners are), and `pets` is not a
    // relation of Cat — both are told, not ignored.
    const response = await request(server()).get("/cats").query("include=pets&withDeleted=true").expect(400);
    expect(response.body.errors.map((e: { code: string }) => e.code)).toEqual([
      "CRUDO_QUERY_UNSUPPORTED_PARAM",
      "CRUDO_QUERY_INVALID_FIELD",
    ]);
  });

  it("embeds relations both ways: a joined owner and batched pets (Phase 15)", async () => {
    const owner = await request(server()).post("/owners").send({ name: "Rae", email: "rae@x.io" }).expect(201);
    const ownerId = owner.body.id as number;
    await request(server())
      .post("/cats")
      .send({ name: "Kit", age: 1, size: "small", indoor: true, livesLeft: 9, owner: ownerId })
      .expect(201);

    // To-one: joined into the list query, projected through OwnerItemDto
    // (so the owner's own `deletedAt` never leaks through the relation).
    const cats = await request(server()).get(`/cats?include=owner&filter[name][eq]=Kit`).expect(200);
    expect(cats.body.items[0]).toMatchObject({ name: "Kit", owner: { id: ownerId, name: "Rae" } });
    expect(cats.body.items[0].owner).not.toHaveProperty("deletedAt");

    // …and narrowed by a per-node fieldset.
    const narrowed = await request(server())
      .get(`/cats?include=owner&fields[owner]=id,name&filter[name][eq]=Kit`)
      .expect(200);
    expect(narrowed.body.items[0].owner).toEqual({ id: ownerId, name: "Rae" });

    // To-many: batched, on both the list and the detail route.
    const owners = await request(server()).get(`/owners?include=pets&filter[id][eq]=${ownerId}`).expect(200);
    expect(owners.body.items[0].pets).toEqual([expect.objectContaining({ name: "Kit" })]);
    const one = await request(server()).get(`/owners/${ownerId}?include=pets`).expect(200);
    expect(one.body.pets).toHaveLength(1);
  });

  it("keeps a relation out of the response until it is included", async () => {
    const owner = await request(server()).post("/owners").send({ name: "Ivo", email: "ivo@x.io" }).expect(201);
    // OwnerItemDto declares `pets`, but the shape is documentation — the
    // include decides the load.
    expect(owner.body).not.toHaveProperty("pets");
  });

  it("documents include and its per-relation fieldsets in the OpenAPI schema", () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const params = (document.paths["/cats"]?.get?.parameters ?? []) as { name: string; description?: string }[];
    expect(params.find((param) => param.name === "include")?.description).toContain("Includable: owner");
    expect(params.map((param) => param.name)).toContain("fields[owner]");
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

  it("associates tags by id and embeds them via a batched many-to-many include", async () => {
    const tagA = await request(server()).post("/tags").send({ name: "playful" }).expect(201);
    const tagB = await request(server()).post("/tags").send({ name: "lazy" }).expect(201);
    const tagIdA = tagA.body.id as number;
    const tagIdB = tagB.body.id as number;

    const cat = await request(server())
      .post("/cats")
      .send({ name: "Tagged", age: 2, size: "small", indoor: true, livesLeft: 9, tags: [tagIdA, tagIdB] })
      .expect(201);
    const catId = cat.body.id as number;

    // Not included until asked (Phase 15): the create response is the plain
    // CatItemDto projection, and tags stay off a plain GET too.
    expect(cat.body).not.toHaveProperty("tags");
    const plain = await request(server()).get(`/cats/${catId}`).expect(200);
    expect(plain.body).not.toHaveProperty("tags");

    const fetched = await request(server()).get(`/cats/${catId}?include=tags`).expect(200);
    expect(fetched.body.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: tagIdA, name: "playful" }),
        expect.objectContaining({ id: tagIdB, name: "lazy" }),
      ]),
    );
    expect(fetched.body.tags).toHaveLength(2);

    // Replacing the tag set on update: this is the case that would fail if
    // the join table needed the prior relation state preloaded before save.
    await request(server()).put(`/cats/${catId}`).send({
      name: "Tagged",
      age: 2,
      size: "small",
      indoor: true,
      livesLeft: 9,
      tags: [tagIdB],
    });
    const afterUpdate = await request(server()).get(`/cats/${catId}?include=tags`).expect(200);
    expect(afterUpdate.body.tags).toEqual([expect.objectContaining({ id: tagIdB, name: "lazy" })]);

    // Clearing the set removes every association.
    await request(server()).put(`/cats/${catId}`).send({
      name: "Tagged",
      age: 2,
      size: "small",
      indoor: true,
      livesLeft: 9,
      tags: [],
    });
    const cleared = await request(server()).get(`/cats/${catId}?include=tags`).expect(200);
    expect(cleared.body.tags).toEqual([]);
  });

  it("keeps include=tags an opt-in allowlist entry, not a free pass", async () => {
    // Dogs never declared `tags` includable — same allowlist rule as any
    // other relation (Phase 15).
    const response = await request(server()).get("/dogs").query("include=tags").expect(400);
    expect(response.body.errors.map((e: { code: string }) => e.code)).toEqual(["CRUDO_QUERY_INVALID_FIELD"]);
  });

  it("counts and slices distinct roots under pagination even when a cat has several tags", async () => {
    const before = await request(server()).get("/cats").query("limit=1").expect(200);
    const totalBefore = before.body.total as number;

    const tags = [];
    for (const name of ["a", "b", "c"]) {
      tags.push((await request(server()).post("/tags").send({ name }).expect(201)).body.id as number);
    }
    const fanOut = await request(server())
      .post("/cats")
      .send({ name: "FanOut", age: 1, size: "small", indoor: true, livesLeft: 9, tags })
      .expect(201);

    const page = await request(server())
      .get("/cats")
      .query("include=tags&limit=2&offset=0")
      .expect(200);
    // Root count/slice is over distinct cats, never joined (cat × tag) rows —
    // a fan-out of 3 tags on one cat must not multiply `total` or the page.
    expect(page.body.total).toBe(totalBefore + 1);
    expect(page.body.items).toHaveLength(2);

    const fanOutRow = (
      await request(server()).get(`/cats/${fanOut.body.id}?include=tags`).expect(200)
    ).body as { tags: unknown[] };
    expect(fanOutRow.tags).toHaveLength(3);
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
