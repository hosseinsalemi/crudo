import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { Column, DeleteDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { QueryValidationException, type DefaultKavoService, type KavoInstance } from "@kavo/core";
import { createTypeOrmKavo } from "@kavo/typeorm";

/**
 * Keyset pagination against the real database (ADR-0019). The keyset
 * predicate is built in core as an ordinary filter AST, so what this suite
 * proves is that `@kavo/typeorm` *composes* it correctly: with the client's
 * own `WHERE`, with include joins, and with the soft-delete scope — and that
 * `skip` is gone.
 */

@Entity()
class Post {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  title!: string;

  @Column("int")
  score!: number;

  @Column("varchar")
  status!: string;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments!: Comment[];
}

@Entity()
class Comment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  body!: string;

  @ManyToOne(() => Post, (post) => post.comments)
  post!: Post;
}

let dataSource: DataSource;
let kavo: KavoInstance;
let posts: DefaultKavoService<Post>;

beforeAll(async () => {
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [Post, Comment],
    synchronize: true,
  });
  await dataSource.initialize();
  kavo = createTypeOrmKavo(dataSource, {
    defaults: {
      pagination: { strategy: "cursor" },
      query: { defaultSort: [{ field: "id", direction: "asc" }] },
    },
  });
  posts = kavo.createCrud(Post, {
    relations: { edges: { comments: { includable: true } } },
  } as never) as DefaultKavoService<Post>;
});

afterAll(async () => {
  await dataSource.destroy();
});

beforeEach(async () => {
  await dataSource.getRepository(Comment).clear();
  await dataSource.getRepository(Post).clear();
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

/** Walk every page, collecting titles in order. */
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

describe("TypeOrmRepositoryAdapter — keyset pagination", () => {
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

  it("pages a mixed asc/desc sort — the ORDER BY and the keyset agree", async () => {
    await seed(7);
    const titles = await walk(2, {
      sort: [
        { field: "score", direction: "desc" },
        { field: "id", direction: "asc" },
      ],
    } as never);
    // score = id % 3, so: 2,2 | 1,1,1 | 0,0 — ties broken by ascending id.
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
    expect(second.total).toBe(4);
    expect(second.meta["nextCursor"]).toBeNull();
  });

  it("composes with an include join without duplicating or dropping rows", async () => {
    await seed(4);
    const all = await posts.findMany({ limit: 10 } as never);
    const target = all.items[0] as Post;
    await dataSource.getRepository(Comment).save([
      { body: "a", post: { id: target.id } },
      { body: "b", post: { id: target.id } },
    ] as never);

    const titles = await walk(2, { include: ["comments"] });
    expect(titles).toEqual(["post-1", "post-2", "post-3", "post-4"]);
  });

  it("keeps soft-deleted rows out of every cursor page", async () => {
    await seed(6);
    const all = await posts.findMany({ limit: 10 } as never);
    await posts.deleteOne((all.items[1] as Post).id);
    await posts.deleteOne((all.items[3] as Post).id);

    expect(await walk(2)).toEqual(["post-1", "post-3", "post-5", "post-6"]);
  });

  it("pages only soft-deleted rows under onlyDeleted", async () => {
    await seed(5);
    const all = await posts.findMany({ limit: 10 } as never);
    await posts.deleteOne((all.items[0] as Post).id);
    await posts.deleteOne((all.items[2] as Post).id);
    await posts.deleteOne((all.items[4] as Post).id);

    expect(await walk(2, { onlyDeleted: true })).toEqual(["post-1", "post-3", "post-5"]);
  });

  it("rejects a tampered cursor as a query validation error", async () => {
    await seed(2);
    await expect(posts.findMany({ limit: 1, cursor: "tampered!!" } as never)).rejects.toBeInstanceOf(
      QueryValidationException,
    );
    await expect(posts.findMany({ limit: 1, cursor: "tampered!!" } as never)).rejects.toMatchObject({
      code: "KAVO_QUERY_INVALID",
      status: 400,
    });
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
