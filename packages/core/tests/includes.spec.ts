import { describe, expect, it } from "vitest";
import { ConfigurationException, QueryValidationException, createCrudo } from "@crudo/core";
import type {
  CrudoInstance,
  CrudoOptions,
  DefaultCrudService,
  EntityConfig,
  EntityMetadata,
  IncludeNode,
} from "@crudo/core";
import {
  Author,
  Comment,
  Post,
  SeededAdapter,
  authorMetadata,
  commentMetadata,
  postMetadata,
} from "./support/blog-fixture.js";

interface Blog {
  crudo: CrudoInstance;
  authors: DefaultCrudService<Author>;
  posts: DefaultCrudService<Post>;
  authorAdapter: SeededAdapter<Author>;
  postAdapter: SeededAdapter<Post>;
  authorRows: Author[];
  postRows: Post[];
}

/**
 * A three-entity graph wired through one root instance, so nested include
 * resolution walks real per-entity configs — the thing that makes a
 * relation unable to widen its target.
 */
function blog(
  configs: {
    author?: EntityConfig<Author>;
    post?: EntityConfig<Post>;
    comment?: EntityConfig<Comment>;
  } = {},
  options: CrudoOptions = {},
): Blog {
  const metadata = new Map<unknown, EntityMetadata<object>>([
    [Author, authorMetadata as EntityMetadata<object>],
    [Post, postMetadata as EntityMetadata<object>],
    [Comment, commentMetadata as EntityMetadata<object>],
  ]);
  const authorAdapter = new SeededAdapter<Author>([]);
  const postAdapter = new SeededAdapter<Post>([]);
  const commentAdapter = new SeededAdapter<Comment>([]);
  const crudo = createCrudo({
    ...options,
    infrastructure: {
      metadataFor: (entity) => metadata.get(entity) as never,
      adapterFor: (entity) =>
        (entity === Author ? authorAdapter : entity === Post ? postAdapter : commentAdapter) as never,
    },
  });
  const authors = crudo.createCrud(Author, configs.author as never) as DefaultCrudService<Author>;
  const posts = crudo.createCrud(Post, configs.post as never) as DefaultCrudService<Post>;
  crudo.createCrud(Comment, configs.comment as never);
  return {
    crudo,
    authors,
    posts,
    authorAdapter,
    postAdapter,
    authorRows: authorAdapter.rows,
    postRows: postAdapter.rows,
  };
}

const authorWithPosts = (): Author =>
  Object.assign(new Author(), {
    id: 1,
    name: "Ada",
    posts: [
      Object.assign(new Post(), {
        id: 10,
        title: "First",
        authorId: 1,
        comments: [Object.assign(new Comment(), { id: 100, body: "nice", postId: 10 })],
      }),
    ],
  });

describe("include resolution (Phase 15)", () => {
  it("rejects a relation nobody opted in — inclusion is an allowlist", async () => {
    const fixture = blog();
    const { authors } = fixture;
    await expect(authors.findMany({ include: ["posts"] })).rejects.toMatchObject({
      issues: [{ field: "posts", code: "CRUDO_QUERY_INVALID_FIELD" }],
    });
  });

  it("rejects an unknown relation with the same 400", async () => {
    const fixture = blog({ author: { relations: { edges: { posts: { includable: true } } } } });
    const { authors } = fixture;
    await expect(authors.findMany({ include: ["ghosts"] })).rejects.toBeInstanceOf(QueryValidationException);
  });

  it("fails at bootstrap when an edge names a relation the entity does not have", () => {
    expect(() => blog({ author: { relations: { edges: { ghosts: { includable: true } } } } })).toThrow(
      ConfigurationException,
    );
  });

  it("merges overlapping paths into one tree", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { relations: { edges: { comments: { includable: true } } } },
    });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());

    await authors.findMany({ include: ["posts", "posts.comments"] });
    const tree = includeTree(fixture.authorAdapter);
    expect(Object.keys(tree)).toEqual(["posts"]);
    expect(Object.keys(tree["posts"]!.children)).toEqual(["comments"]);
    expect(tree["posts"]!.path).toBe("posts");
    expect(tree["posts"]!.children["comments"]!.path).toBe("posts.comments");
  });

  it("resolves auto strategies from cardinality: to-one joins, to-many batches", async () => {
    const fixture = blog({
      post: { relations: { edges: { author: { includable: true }, comments: { includable: true } } } },
    });
    const { posts, postRows } = fixture;
    postRows.push(Object.assign(new Post(), { id: 10, title: "First" }));

    await posts.findMany({ include: ["author", "comments"] });
    const tree = includeTree(fixture.postAdapter);
    expect(tree["author"]!.strategy).toBe("join");
    expect(tree["comments"]!.strategy).toBe("batch");
  });

  it("honors an explicit strategy over the heuristic", async () => {
    const fixture = blog({
      post: { relations: { edges: { comments: { includable: true, strategy: "join" } } } },
    });
    const { posts, postRows } = fixture;
    postRows.push(Object.assign(new Post(), { id: 10 }));
    await posts.findMany({ include: ["comments"] });
    expect(includeTree(fixture.postAdapter)["comments"]!.strategy).toBe("join");
  });

  it("carries the target's delete strategy, not the root's", async () => {
    const fixture = blog({ author: { relations: { edges: { posts: { includable: true } } } } });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());
    await authors.findMany({ include: ["posts"] });
    // Author has no marker field; Post does.
    expect(includeTree(fixture.authorAdapter)["posts"]!.softDelete).toEqual({ strategy: "soft", field: "deletedAt" });
  });

  it("enforces maxIncludeDepth", async () => {
    const fixture = blog(
      {
        author: { relations: { edges: { posts: { includable: true } } } },
        post: { relations: { edges: { comments: { includable: true } } } },
      },
      { defaults: { relations: { maxIncludeDepth: 1 } } },
    );
    const { authors } = fixture;
    await expect(authors.findMany({ include: ["posts.comments"] })).rejects.toMatchObject({
      issues: [{ field: "posts.comments", code: "CRUDO_QUERY_LIMIT_EXCEEDED" }],
    });
  });

  it("lets a per-relation maxDepth override the budget below it", async () => {
    const fixture = blog(
      {
        author: { relations: { edges: { posts: { includable: true, maxDepth: 3 } } } },
        post: { relations: { edges: { comments: { includable: true } } } },
      },
      { defaults: { relations: { maxIncludeDepth: 1 } } },
    );
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());
    const list = await authors.findMany({ include: ["posts.comments"] });
    expect(Object.keys(includeTree(fixture.authorAdapter)["posts"]!.children)).toEqual(["comments"]);
    expect(list.items[0]).toMatchObject({ posts: [{ comments: [{ body: "nice" }] }] });
  });

  it("enforces maxIncludedNodes across the whole tree", async () => {
    const fixture = blog(
      { post: { relations: { edges: { author: { includable: true }, comments: { includable: true } } } } },
      { defaults: { relations: { maxIncludedNodes: 1 } } },
    );
    const { posts, postRows } = fixture;
    postRows.push(Object.assign(new Post(), { id: 10 }));
    await expect(posts.findMany({ include: ["author", "comments"] })).rejects.toMatchObject({
      issues: [{ code: "CRUDO_QUERY_LIMIT_EXCEEDED" }],
    });
  });

  it("bounds a self-revisiting path by depth, not by visited types", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { relations: { edges: { author: { includable: true } } } },
    });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());
    // posts.author revisits Author — legal, because depth is the contract.
    await expect(authors.findMany({ include: ["posts.author"] })).resolves.toBeDefined();
    await expect(authors.findMany({ include: ["posts.author.posts"] })).rejects.toMatchObject({
      issues: [{ code: "CRUDO_QUERY_LIMIT_EXCEEDED" }],
    });
  });

  it("adds defaultInclude relations with no include param at all", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true, defaultInclude: true } } } },
    });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());
    const list = await authors.findMany();
    expect(list.items[0]).toMatchObject({ name: "Ada", posts: [{ title: "First" }] });
  });
});

describe("include serialization (Phase 15)", () => {
  it("projects an included node through the target's own shape", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { allowlists: { selectable: ["id", "title"] } },
    });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());

    const list = await authors.findMany({ include: ["posts"] });
    // `authorId` and `deletedAt` are columns of Post, so the derived
    // default still emits them — the allowlist governs *selection*.
    expect(list.items[0]).toMatchObject({ id: 1, name: "Ada" });
    expect((list.items[0] as { posts: unknown[] }).posts[0]).toMatchObject({ id: 10, title: "First" });
  });

  it("narrows an included node with fields[path], validated against the target", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
    });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());

    const list = await authors.findMany({
      include: ["posts"],
      fields: { relations: { posts: ["id", "title"] } },
    });
    expect((list.items[0] as { posts: unknown[] }).posts[0]).toEqual({ id: 10, title: "First" });
  });

  it("rejects a fieldset the target does not allow", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { allowlists: { selectable: ["id"] } },
    });
    const { authors } = fixture;
    await expect(
      authors.findMany({ include: ["posts"], fields: { relations: { posts: ["title"] } } }),
    ).rejects.toMatchObject({
      issues: [{ field: "posts.title", code: "CRUDO_QUERY_INVALID_FIELD" }],
    });
  });

  it("omits relation keys that were not included", async () => {
    const fixture = blog({ author: { relations: { edges: { posts: { includable: true } } } } });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());
    const list = await authors.findMany();
    expect(list.items[0]).not.toHaveProperty("posts");
  });

  it("emits an empty list / null for a relation with nothing loaded", async () => {
    const fixture = blog({
      post: { relations: { edges: { author: { includable: true }, comments: { includable: true } } } },
    });
    const { posts, postRows } = fixture;
    postRows.push(Object.assign(new Post(), { id: 10, title: "Lonely", author: null, comments: [] }));
    const list = await posts.findMany({ include: ["author", "comments"] });
    expect(list.items[0]).toMatchObject({ author: null, comments: [] });
  });
});

describe("association by id (Phase 15, ADR-0014)", () => {
  it("accepts a scalar id, an { id } reference, and narrows a deep payload", async () => {
    const fixture = blog();
    const { posts, postAdapter } = fixture;

    const created = await posts.createOne({ title: "a", author: 7 } as never);
    expect(created).toMatchObject({ title: "a" });
    expect(lastRow(postAdapter)["author"]).toEqual({ id: 7 });

    // A nested object is narrowed to the id: association, never a deep write.
    await posts.createOne({ title: "b", author: { id: 8, name: "smuggled" } } as never);
    expect(lastRow(postAdapter)["author"]).toEqual({ id: 8 });

    await posts.createOne({ title: "c", author: null } as never);
    expect(lastRow(postAdapter)["author"]).toBeNull();
  });

  it("maps a to-many association element-wise", async () => {
    const fixture = blog();
    const { authors, authorAdapter } = fixture;
    await authors.createOne({ name: "Ada", posts: [1, { id: 2 }] } as never);
    expect(lastRow(authorAdapter)["posts"]).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

/** The include tree the adapter last received — what resolution produced. */
function includeTree<Entity extends object>(adapter: SeededAdapter<Entity>): Record<string, IncludeNode> {
  return (adapter.lastQuery?.include ?? {}) as Record<string, IncludeNode>;
}

/** The row the adapter last stored — what deserialization produced. */
function lastRow<Entity extends object>(adapter: SeededAdapter<Entity>): Record<string, unknown> {
  return adapter.rows[adapter.rows.length - 1] as Record<string, unknown>;
}
