import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collection, MikroORM } from "@mikro-orm/core";
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";
import { QueryValidationException, type DefaultKavoService, type KavoInstance } from "@kavo/core";
import { createMikroOrmKavo } from "@kavo/mikroorm";
import { clearDatabase, newTestOrm } from "./support/database.js";

/**
 * Keyset pagination against a real MikroORM `EntityManager` (ADR-0019).
 *
 * MikroORM's query surface is declarative like Prisma's, so the keyset
 * predicate goes through the same `translateFilter` path as any other
 * filter and `offset` simply drops out of the find options. What this suite
 * pins down is that it composes with the client's own filter, with
 * `populate`, and with the config-declared soft-delete column.
 */

@Entity()
class Post {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  title!: string;

  @Property({ type: "number" })
  score!: number;

  @Property({ type: "string" })
  status!: string;

  @Property({ type: "Date", nullable: true })
  deletedAt: Date | null = null;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments = new Collection<Comment>(this);
}

@Entity()
class Comment {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  body!: string;

  @ManyToOne(() => Post, { nullable: true })
  post: Post | null = null;
}

let orm: MikroORM;
let kavo: KavoInstance;
let posts: DefaultKavoService<Post>;

beforeAll(async () => {
  orm = await newTestOrm([Post, Comment]);
  kavo = createMikroOrmKavo(orm, {
    defaults: {
      pagination: { strategy: "cursor" },
      query: { defaultSort: [{ field: "id", direction: "asc" }] },
    },
  });
  posts = kavo.createCrud(Post, {
    softDelete: { field: "deletedAt" },
    relations: { edges: { comments: { includable: true } } },
  } as never) as DefaultKavoService<Post>;
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  await clearDatabase(orm);
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

describe("MikroOrmRepositoryAdapter — keyset pagination", () => {
  it("walks the whole table exactly once, in order", async () => {
    await seed(7);
    expect(await walk(3)).toEqual(["post-1", "post-2", "post-3", "post-4", "post-5", "post-6", "post-7"]);
  });

  it("reports null on the last page and a token before it", async () => {
    await seed(3);
    const first = await posts.findMany({ limit: 2 } as never);
    expect(typeof first.meta["nextCursor"]).toBe("string");
    const second = await posts.findMany({ limit: 2, cursor: first.meta["nextCursor"] } as never);
    expect(second.items).toHaveLength(1);
    expect(second.meta["nextCursor"]).toBeNull();
  });

  it("returns an empty page with no cursor for an empty table", async () => {
    const page = await posts.findMany({ limit: 5 } as never);
    expect(page.items).toEqual([]);
    expect(page.meta["nextCursor"]).toBeNull();
    expect(page.total).toBe(0);
  });

  it("pages a mixed asc/desc sort — the orderBy and the keyset agree", async () => {
    await seed(7);
    const titles = await walk(2, {
      sort: [
        { field: "score", direction: "desc" },
        { field: "id", direction: "asc" },
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
    const all = await posts.findMany({ limit: 10 } as never);
    const em = orm.em.fork();
    const target = await em.findOneOrFail(Post, { id: (all.items[0] as Post).id });
    em.persist([em.create(Comment, { body: "a", post: target }), em.create(Comment, { body: "b", post: target })]);
    await em.flush();

    expect(await walk(2, { include: ["comments"] })).toEqual(["post-1", "post-2", "post-3", "post-4"]);
  });

  it("keeps soft-deleted rows out of every cursor page", async () => {
    await seed(6);
    const all = await posts.findMany({ limit: 10 } as never);
    await posts.deleteOne((all.items[1] as Post).id);
    await posts.deleteOne((all.items[3] as Post).id);

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
