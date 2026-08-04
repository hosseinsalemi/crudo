import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Schema } from "mongoose";
import { QueryValidationException, type DefaultKavoService, type KavoInstance } from "@kavo/core";
import { createMongooseKavo } from "@kavo/mongoose";
import { clearCollections, startTestDatabase, type TestDatabase } from "./support/database.js";

/**
 * Keyset pagination against a real MongoDB (ADR-0019).
 *
 * MongoDB's primary key is `_id`, so the unique tiebreaker every cursor
 * query must end in is `_id` — and it is an `ObjectId`, which the adapter
 * renders as a hex string on the way out (ADR-0018). That makes the cursor
 * payload a string that Mongoose casts back to an `ObjectId` on the way in,
 * which is the round trip this suite is really pinning down.
 */

interface Post {
  _id: string;
  title: string;
  score: number;
  status: string;
  deletedAt: Date | null;
  comments?: Comment[];
}

interface Comment {
  _id: string;
  body: string;
}

function defineModels(connection: TestDatabase["connection"]) {
  return {
    Post: connection.model(
      "Post",
      new Schema({
        title: String,
        score: Number,
        status: String,
        deletedAt: { type: Date, default: null },
        comments: [{ type: Schema.Types.ObjectId, ref: "Comment" }],
      }),
    ),
    Comment: connection.model("Comment", new Schema({ body: String })),
  };
}

let database: TestDatabase;
let kavo: KavoInstance;
let models: ReturnType<typeof defineModels>;
let posts: DefaultKavoService<Post>;

beforeAll(async () => {
  database = await startTestDatabase();
  models = defineModels(database.connection);
  kavo = createMongooseKavo(database.connection, {
    defaults: {
      pagination: { strategy: "cursor" },
      query: { defaultSort: [{ field: "_id", direction: "asc" }] },
    },
  });
  posts = kavo.createCrud(models.Post, {
    softDelete: { field: "deletedAt" },
    relations: { edges: { comments: { includable: true } } },
  } as never) as unknown as DefaultKavoService<Post>;
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await clearCollections(database.connection);
});

async function seed(count: number): Promise<void> {
  for (let index = 1; index <= count; index++) {
    await posts.createOne({
      title: `post-${index}`,
      score: index % 3,
      status: index % 2 === 0 ? "published" : "draft",
    } as never);
  }
}

async function walk(limit: number, query: Record<string, unknown> = {}): Promise<string[]> {
  const titles: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const result = await posts.findMany({ ...query, limit, cursor } as never);
    titles.push(...result.items.map((item) => (item as Post).title));
    cursor = result.meta["nextCursor"] as string | null;
    if (cursor === null) return titles;
  }
  throw new Error("cursor paging did not terminate");
}

describe("MongooseRepositoryAdapter — keyset pagination", () => {
  it("walks the whole collection exactly once, in order", async () => {
    await seed(7);
    expect(await walk(3)).toEqual(["post-1", "post-2", "post-3", "post-4", "post-5", "post-6", "post-7"]);
  });

  it("round-trips the hex-string _id in the cursor back into an ObjectId comparison", async () => {
    await seed(3);
    const first = await posts.findMany({ limit: 1 } as never);
    expect(typeof first.meta["nextCursor"]).toBe("string");

    const second = await posts.findMany({ limit: 1, cursor: first.meta["nextCursor"] } as never);
    expect((second.items[0] as Post).title).toBe("post-2");
    expect((second.items[0] as Post)._id).not.toBe((first.items[0] as Post)._id);
  });

  it("reports null on the last page", async () => {
    await seed(3);
    const page = await posts.findMany({ limit: 3 } as never);
    expect(page.items).toHaveLength(3);
    expect(page.meta["nextCursor"]).toBeNull();
  });

  it("returns an empty page with no cursor for an empty collection", async () => {
    const page = await posts.findMany({ limit: 5 } as never);
    expect(page.items).toEqual([]);
    expect(page.meta["nextCursor"]).toBeNull();
    expect(page.total).toBe(0);
  });

  it("pages a mixed asc/desc sort — the sort and the keyset agree", async () => {
    await seed(7);
    const titles = await walk(2, {
      sort: [
        { field: "score", direction: "desc" },
        { field: "_id", direction: "asc" },
      ],
    } as never);
    expect(titles).toEqual(["post-2", "post-5", "post-1", "post-4", "post-7", "post-3", "post-6"]);
    expect(new Set(titles).size).toBe(7);
  });

  it("composes with the client's own filter, and total still spans the match set", async () => {
    await seed(8);
    const published = { filter: { kind: "condition", field: "status", operator: "EQ", value: "published" } };

    const first = await posts.findMany({ ...published, limit: 2 } as never);
    expect(first.items.map((item) => (item as Post).title)).toEqual(["post-2", "post-4"]);
    expect(first.total).toBe(4);

    const second = await posts.findMany({ ...published, limit: 2, cursor: first.meta["nextCursor"] } as never);
    expect(second.items.map((item) => (item as Post).title)).toEqual(["post-6", "post-8"]);
    expect(second.meta["nextCursor"]).toBeNull();
  });

  it("composes with a populate without duplicating or dropping rows", async () => {
    await seed(4);
    const comment = await models.Comment.create({ body: "a" });
    const all = await posts.findMany({ limit: 10 } as never);
    await models.Post.updateOne({ _id: (all.items[0] as Post)._id }, { comments: [comment._id] });

    expect(await walk(2, { include: ["comments"] })).toEqual(["post-1", "post-2", "post-3", "post-4"]);
  });

  it("keeps soft-deleted rows out of every cursor page", async () => {
    await seed(6);
    const all = await posts.findMany({ limit: 10 } as never);
    await posts.deleteOne((all.items[1] as Post)._id);
    await posts.deleteOne((all.items[3] as Post)._id);

    expect(await walk(2)).toEqual(["post-1", "post-3", "post-5", "post-6"]);
  });

  it("rejects a tampered cursor as a query validation error", async () => {
    await seed(2);
    await expect(posts.findMany({ limit: 1, cursor: "tampered!!" } as never)).rejects.toBeInstanceOf(
      QueryValidationException,
    );
  });

  it("rejects a sort with no unique tiebreaker", async () => {
    await expect(
      posts.findMany({ limit: 2, sort: [{ field: "score", direction: "asc" }] } as never),
    ).rejects.toMatchObject({
      code: "KAVO_QUERY_INVALID",
      issues: [{ field: "sort", code: "KAVO_QUERY_CONFLICTING_PARAMS" }],
    });
  });
});
