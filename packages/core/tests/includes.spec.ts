import { describe, expect, it } from "vitest";
import { ConfigurationException, QueryValidationException, createKavo } from "@kavo/core";
import type {
  KavoInstance,
  KavoOptions,
  DefaultKavoService,
  EntityConfig,
  EntityMetadata,
  IncludeNode,
  IncludePath,
} from "@kavo/core";
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
  kavo: KavoInstance;
  authors: DefaultKavoService<Author>;
  posts: DefaultKavoService<Post>;
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
  options: KavoOptions = {},
): Blog {
  const metadata = new Map<unknown, EntityMetadata<object>>([
    [Author, authorMetadata as EntityMetadata<object>],
    [Post, postMetadata as EntityMetadata<object>],
    [Comment, commentMetadata as EntityMetadata<object>],
  ]);
  const authorAdapter = new SeededAdapter<Author>([]);
  const postAdapter = new SeededAdapter<Post>([]);
  const commentAdapter = new SeededAdapter<Comment>([]);
  const adapters = new Map<unknown, unknown>([
    [Author, authorAdapter],
    [Post, postAdapter],
    [Comment, commentAdapter],
  ]);
  const kavo = createKavo({
    ...options,
    infrastructure: {
      metadataFor: (entity) => metadata.get(entity) as never,
      adapterFor: (entity) => adapters.get(entity) as never,
    },
  });
  const authors = kavo.createCrud(Author, configs.author as never) as DefaultKavoService<Author>;
  const posts = kavo.createCrud(Post, configs.post as never) as DefaultKavoService<Post>;
  kavo.createCrud(Comment, configs.comment as never);
  return {
    kavo,
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

describe("include resolution", () => {
  it("rejects a relation nobody opted in — inclusion is an allowlist", async () => {
    const fixture = blog();
    const { authors } = fixture;
    await expect(authors.findMany({ include: ["posts"] })).rejects.toMatchObject({
      issues: [{ field: "posts", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("rejects an unknown relation with the same 400", async () => {
    const fixture = blog({ author: { relations: { edges: { posts: { includable: true } } } } });
    const { authors } = fixture;
    // `IncludePath` rejects 'ghosts' at compile time now, which is the point
    // of the type — but the *runtime* rejection is a separate guarantee and
    // still has to hold: wire requests arrive as strings and never meet the
    // type. Casting keeps that path under test.
    const unknownPath = ["ghosts"] as unknown as readonly IncludePath<Author>[];
    await expect(authors.findMany({ include: unknownPath })).rejects.toBeInstanceOf(QueryValidationException);
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
      issues: [{ field: "posts.comments", code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
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
      issues: [{ code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
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
      issues: [{ code: "KAVO_QUERY_LIMIT_EXCEEDED" }],
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

describe("include serialization", () => {
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

  it("accepts the relation-keyed fields spelling identically", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
    });
    const { authors, authorRows } = fixture;
    authorRows.push(authorWithPosts());

    // `{ posts: [...] }` is sugar for `{ relations: { posts: [...] } }` — the
    // sugar has to survive include resolution, not just normalization.
    const list = await authors.findMany({
      include: ["posts"],
      fields: { posts: ["id", "title"] },
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
      issues: [{ field: "posts.title", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("rejects a non-array relation fieldset value rather than throwing", async () => {
    // Runtime strings — or, here, a caller bypassing the type entirely —
    // can hand the resolver a shape `IncludeRequest.fields` was never meant
    // to carry. This must fail the same way a malformed top-level `fields`
    // value does: one issue, never an uncaught error that surfaces as 500.
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
    });
    const { authors } = fixture;
    await expect(
      authors.findMany({ include: ["posts"], fields: { relations: { posts: 5 as never } } }),
    ).rejects.toMatchObject({
      issues: [{ field: "posts", code: "KAVO_QUERY_INVALID_VALUE" }],
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

  it("normalizes a null to-many relation to an empty array, never null", async () => {
    // Adapters disagree on whether an unhydrated collection comes back as
    // `[]` or `null`; the envelope must not leak that difference, or a
    // client would have to null-check a field the schema types as a list.
    const fixture = blog({
      post: { relations: { edges: { comments: { includable: true } } } },
    });
    const { posts, postRows } = fixture;
    postRows.push(Object.assign(new Post(), { id: 11, title: "Null comments", comments: null as never }));
    const list = await posts.findMany({ include: ["comments"] });
    expect(list.items[0]).toMatchObject({ comments: [] });
  });
});

describe("association by id (ADR-0014)", () => {
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

/**
 * Issue #7: the two ways an include can be rejected used to render the
 * identical sentence, so the message could not tell a typo from a
 * permission that was never granted. Assertions stay on the actionable
 * clause (`toContain`), never on the whole string — the prose is meant to
 * keep improving.
 */
describe("include rejection messages", () => {
  const detailOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (error) {
      const issues = (error as QueryValidationException).issues;
      expect(issues).toHaveLength(1);
      return issues[0]!.detail;
    }
    throw new Error("expected QueryValidationException");
  };

  it("says the same thing for a relation that exists and one that does not", async () => {
    // The oracle this closes: `Author.posts` is real but never opted in,
    // `ghosts` is not a relation at all. Inclusion is opt-in and defaults to
    // empty, so a message that distinguished them would confirm the
    // existence of every edge the config deliberately closed — one guessed
    // name per request. Both rejections differ only in the name echoed back.
    const { authors } = blog();
    const real = await detailOf(() => authors.findMany({ include: ["posts"] }));
    const invented = await detailOf(() =>
      authors.findMany({ include: ["ghosts"] as unknown as readonly IncludePath<Author>[] }),
    );
    expect(real.replace(/posts/g, "X")).toBe(invented.replace(/ghosts/g, "X"));
    expect(real).toContain("is not includable on Author");
    expect(invented).toContain("is not includable on Author");
  });

  it("names the config key that opts a real relation in", async () => {
    const { authors } = blog();
    const detail = await detailOf(() => authors.findMany({ include: ["posts"] }));
    expect(detail).toContain("relations.edges.posts.includable = true");
    expect(detail).toContain("on the Author config");
  });

  it("lists the includable relations, and says 'none' when the default empty config is why", async () => {
    const { authors } = blog();
    const detail = await detailOf(() =>
      authors.findMany({ include: ["ghosts"] as unknown as readonly IncludePath<Author>[] }),
    );
    expect(detail).toContain("Includable relations on Author: none.");
  });

  it("suggests the near miss, drawn only from relations already opted in", async () => {
    const { authors } = blog({ author: { relations: { edges: { posts: { includable: true } } } } });
    const detail = await detailOf(() =>
      authors.findMany({ include: ["postz"] as unknown as readonly IncludePath<Author>[] }),
    );
    expect(detail).toContain("Did you mean 'posts'?");
  });

  it("never enumerates a relation the config has not opted in", async () => {
    // The disclosure rule: a rejection may name only what the client is
    // already permitted to ask for. `Post.author` exists in metadata but no
    // edge names it, so it must not appear.
    const { authors } = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
    });
    const detail = await detailOf(() =>
      authors.findMany({ include: ["posts.authr"] as unknown as readonly IncludePath<Author>[] }),
    );
    expect(detail).toContain("Includable relations on Post: none.");
    expect(detail).not.toContain("'author'");
  });

  it("blames the entity that owns the failing segment, not the root", async () => {
    const { authors } = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
    });
    const detail = await detailOf(() =>
      authors.findMany({ include: ["posts.comments"] as unknown as readonly IncludePath<Author>[] }),
    );
    expect(detail).toContain("is not includable on Post");
    expect(detail).toContain("(in include path 'posts.comments')");
    expect(detail).toContain("on the Post config");
    expect(detail).not.toContain("Author");
  });

  it("names the target entity's allowlist when a relation fieldset is rejected", async () => {
    const { authors } = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { allowlists: { selectable: ["id", "title"] } },
    });
    const detail = await detailOf(() =>
      authors.findMany({ include: ["posts"], fields: { relations: { posts: ["titel"] } } }),
    );
    expect(detail).toContain("Did you mean 'title'?");
    expect(detail).toContain("Selectable fields on Post: id, title.");
    expect(detail).toContain("allowlists.selectable on the Post config");
  });
});

describe("defaultInclude", () => {
  it("does not duplicate a relation the client also asked for, and keeps the requested subtree", () => {
    // The dedupe has to lose to the client's own draft, not the other way
    // round: a `defaultInclude` node carries no children, so clobbering
    // would silently drop `posts.comments` from the response.
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true, defaultInclude: true } } } },
      post: { relations: { edges: { comments: { includable: true } } } },
    } as never);

    return fixture.authors.findMany({ include: ["posts.comments"] } as never).then(() => {
      const tree = includeTree(fixture.authorAdapter);
      expect(Object.keys(tree)).toEqual(["posts"]);
      expect(Object.keys(tree["posts"]!.children)).toEqual(["comments"]);
    });
  });

  it("gives a nested defaultInclude relation its full dotted path", async () => {
    // `path` is what `fields[...]` and every issue message key off, so a
    // nested default that reported a bare name would be unaddressable.
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { relations: { edges: { comments: { includable: true, defaultInclude: true } } } },
    } as never);

    await fixture.authors.findMany({ include: ["posts"] } as never);

    const tree = includeTree(fixture.authorAdapter);
    expect(tree["posts"]!.children["comments"]!.path).toBe("posts.comments");
  });
});

describe("relations.edges — naming an edge is the opt-in", () => {
  it("treats an edge that omits includable as includable", async () => {
    // The registry documents this default; every other test in the file
    // spells `includable: true`, which would leave it free to regress.
    const fixture = blog({
      author: { relations: { edges: { posts: { strategy: "join" } } } },
    } as never);

    await fixture.authors.findMany({ include: ["posts"] } as never);

    expect(Object.keys(includeTree(fixture.authorAdapter))).toEqual(["posts"]);
  });

  it("still honours an explicit includable: false", async () => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: false, strategy: "join" } } } },
    } as never);

    await expect(fixture.authors.findMany({ include: ["posts"] } as never)).rejects.toBeInstanceOf(
      QueryValidationException,
    );
  });

  it("says 'none' rather than trailing a bare colon when the entity has no relations at all", () => {
    // `Comment` declares no relations, so the message has an empty list to
    // render — the one case where the join would produce nothing.
    expect(() => blog({ comment: { relations: { edges: { ghosts: { includable: true } } } } } as never)).toThrow(
      /relations: none/,
    );
  });
});

describe("malformed include paths", () => {
  it.each([
    ["a trailing dot", "posts."],
    ["a leading dot", ".posts"],
    ["a doubled dot", "posts..comments"],
    ["an empty string", ""],
  ])("rejects %s as a query issue rather than building an empty-named node", async (_label, path) => {
    const fixture = blog({
      author: { relations: { edges: { posts: { includable: true } } } },
      post: { relations: { edges: { comments: { includable: true } } } },
    } as never);

    const issues = await fixture.authors
      .findMany({ include: [path] } as unknown as { include: readonly IncludePath<Author>[] })
      .then(
        () => {
          throw new Error("expected a QueryValidationException");
        },
        (error: unknown) => (error as QueryValidationException).issues,
      );

    expect(issues[0]).toMatchObject({ field: "include", code: "KAVO_QUERY_INVALID_VALUE" });
  });
});

describe("an includable relation whose target is unknown to this instance", () => {
  it("reports an unsupported-param issue on that path instead of throwing a TypeError", async () => {
    // `Comment` is never registered here, so the catalog cannot resolve
    // `posts.comments`'s target. A missing `createCrud` call is an ordinary
    // adopter mistake and must not surface as a crash.
    const metadata = new Map<unknown, EntityMetadata<object>>([
      [Author, authorMetadata as EntityMetadata<object>],
      [Post, postMetadata as EntityMetadata<object>],
    ]);
    const authorAdapter = new SeededAdapter<Author>([]);
    const postAdapter = new SeededAdapter<Post>([]);
    const adapters = new Map<unknown, unknown>([
      [Author, authorAdapter],
      [Post, postAdapter],
    ]);
    const kavo = createKavo({
      infrastructure: {
        metadataFor: (entity) => metadata.get(entity) as never,
        adapterFor: (entity) => adapters.get(entity) as never,
      },
    });
    const authors = kavo.createCrud(Author, {
      relations: { edges: { posts: { includable: true } } },
    } as never) as DefaultKavoService<Author>;
    kavo.createCrud(Post, { relations: { edges: { comments: { includable: true } } } } as never);

    const issues = await authors.findMany({ include: ["posts.comments"] } as never).then(
      () => {
        throw new Error("expected a QueryValidationException");
      },
      (error: unknown) => (error as QueryValidationException).issues,
    );

    expect(issues[0]).toMatchObject({ field: "posts.comments", code: "KAVO_QUERY_UNSUPPORTED_PARAM" });
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
