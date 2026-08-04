import { describe, expect, it, vi } from "vitest";
import type {
  ComputedFieldMap,
  DefaultKavoService,
  EntityConfig,
  EntityMetadata,
  KavoContext,
  ListResultDto,
} from "@kavo/core";
import {
  ConfigurationException,
  DefaultDeserializer,
  QueryValidationException,
  WireQuery,
  createKavo,
} from "@kavo/core";
import { InMemoryUserAdapter, User, contextStub, userMetadata } from "./support/user-fixture.js";
import {
  Author,
  Comment,
  Post,
  SeededAdapter,
  authorMetadata,
  commentMetadata,
  postMetadata,
} from "./support/blog-fixture.js";

/** `fullName`-style descriptor: derived from two real columns, nothing else. */
const shout = {
  resolve: (user: User): string => user.name.toUpperCase(),
};

function makeCrud(config: EntityConfig<User> = {}) {
  const adapter = new InMemoryUserAdapter();
  const kavo = createKavo();
  const crud = kavo.createCrud(User, config as never, { adapter, metadata: userMetadata }) as DefaultKavoService<User>;
  return { crud, adapter, kavo };
}

async function seeded(config: EntityConfig<User> = {}) {
  const fixture = makeCrud(config);
  await fixture.crud.createOne({ name: "Ada", email: "ada@example.com", age: 36 } as never);
  return fixture;
}

describe("computed fields — default projection (ADR-0019)", () => {
  it("appears in a findOne response with no DTO registered", async () => {
    const { crud } = await seeded({ computed: { shout } } as never);
    expect(await crud.findOne(1)).toMatchObject({ id: 1, name: "Ada", shout: "ADA" });
  });

  it("appears on every element of a findMany response", async () => {
    const { crud } = await seeded({ computed: { shout } } as never);
    await crud.createOne({ name: "Grace", email: "g@example.com", age: 45 } as never);
    const list = (await crud.findMany()) as unknown as ListResultDto<User & { shout: string }>;
    expect(list.items.map((item) => item.shout)).toEqual(["ADA", "GRACE"]);
  });

  it("is evaluated, not read off the row — a plain object works like a class instance", async () => {
    // The whole point over the "register a DTO naming a class getter"
    // workaround: `@kavo/prisma` and `@kavo/mongoose` hand the engine plain
    // objects that carry no getter at all.
    const adapter = new SeededAdapter<User>([{ id: 1, name: "Ada", email: "a@x.io", age: 36 } as User]);
    const crud = createKavo().createCrud(User, { computed: { shout } } as never, {
      adapter: adapter as never,
      metadata: userMetadata,
    }) as DefaultKavoService<User>;
    expect(await crud.findOne(1)).toEqual({ id: 1, name: "Ada", email: "a@x.io", age: 36, shout: "ADA" });
  });

  it("receives the same KavoContext a custom handler gets, so it can vary by caller", async () => {
    let seen: KavoContext<User> | null = null;
    const { crud } = await seeded({
      computed: {
        viewer: {
          resolve: (_user: User, context: KavoContext<User>) => {
            seen = context;
            return (context.principal as { id: string } | null)?.id ?? "anonymous";
          },
        },
      },
    } as never);
    const item = (await crud.findOne(1, undefined, { principal: { id: "u-7" } })) as User & { viewer: string };
    expect(item.viewer).toBe("u-7");
    expect(seen).toMatchObject({ entityName: "User", operation: "findOne" });
    expect((seen as unknown as KavoContext<User>).correlationId).toEqual(expect.any(String));
  });
});

describe("computed fields — DTO narrowing (doc 04 §5)", () => {
  it("is narrowed out by an explicit item DTO that omits it", async () => {
    class UserItemDto {
      id = 0;
      name = "";
    }
    const { crud } = await seeded({ computed: { shout }, dto: { item: UserItemDto } } as never);
    expect(await crud.findOne(1)).toEqual({ id: 1, name: "Ada" });
  });

  it("is still evaluated when an explicit item DTO names it", async () => {
    class UserItemDto {
      id = 0;
      shout = "";
    }
    const { crud } = await seeded({ computed: { shout }, dto: { item: UserItemDto } } as never);
    expect(await crud.findOne(1)).toEqual({ id: 1, shout: "ADA" });
  });
});

describe("computed fields — selection", () => {
  it("is selectable by default, so fields= can name it", async () => {
    const { crud } = await seeded({ computed: { shout } } as never);
    expect(await crud.findOne(1, { fields: ["name", "shout"] } as never)).toEqual({ name: "Ada", shout: "ADA" });
  });

  it("is selectable over the wire grammar too", async () => {
    const { crud } = await seeded({ computed: { shout } } as never);
    const list = (await crud.findMany(new WireQuery({ fields: "shout" }) as never)) as unknown as ListResultDto<{
      shout: string;
    }>;
    expect(list.items).toEqual([{ shout: "ADA" }]);
  });

  it("is dropped by a fieldset that does not name it — selection narrows uniformly", async () => {
    const { crud } = await seeded({ computed: { shout } } as never);
    expect(await crud.findOne(1, { fields: ["name"] } as never)).toEqual({ name: "Ada" });
  });

  it("opts out of the selectable allowlist with `selectable: false` and is then a 400", async () => {
    const { crud } = await seeded({
      computed: { shout: { ...shout, selectable: false } },
    } as never);
    // Still present in the default projection …
    expect(await crud.findOne(1)).toMatchObject({ shout: "ADA" });
    // … but outside the allowlist, so naming it is rejected, never dropped.
    await expect(crud.findOne(1, { fields: ["shout"] } as never)).rejects.toMatchObject({
      code: "KAVO_QUERY_INVALID",
      issues: [{ field: "shout", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
    // And the limit of what the flag buys: `selectable: false` narrows the
    // allowlist, not the projection, so any fieldset that omits the field
    // still drops it — with no way for the client to ask for it back.
    expect(await crud.findOne(1, { fields: ["name"] } as never)).toEqual({ name: "Ada" });
  });

  it("survives an `{ exclude }` selectable list, which resolves against columns *and* computed", async () => {
    // The exclude form resolves against the same base set the plain default
    // uses; a regression to own-columns-only here is invisible to the
    // default-selector cases above, because that is a different branch.
    const { crud } = await seeded({
      computed: { shout },
      allowlists: { selectable: { exclude: ["email"] } },
    } as never);
    expect(await crud.findOne(1, { fields: ["shout"] } as never)).toEqual({ shout: "ADA" });
    await expect(crud.findOne(1, { fields: ["email"] } as never)).rejects.toBeInstanceOf(QueryValidationException);
  });

  it("can be excluded by name, without leaving the default projection", async () => {
    const { crud } = await seeded({
      computed: { shout },
      allowlists: { selectable: { exclude: ["shout"] } },
    } as never);
    expect(await crud.findOne(1)).toMatchObject({ shout: "ADA" });
    await expect(crud.findOne(1, { fields: ["shout"] } as never)).rejects.toMatchObject({
      code: "KAVO_QUERY_INVALID",
      issues: [{ field: "shout", code: "KAVO_QUERY_INVALID_FIELD" }],
    });
  });

  it("lets an explicit selectable list override the descriptor's `selectable: false`", async () => {
    // The descriptor's flag governs the *derived* default; naming the field
    // in an explicit list is the same deliberate opt-in that an explicit
    // list always is, so it wins — the flag is a default, not a veto.
    const { crud } = await seeded({
      computed: { shout: { ...shout, selectable: false } },
      allowlists: { selectable: ["id", "shout"] },
    } as never);
    expect(await crud.findOne(1, { fields: ["shout"] } as never)).toEqual({ shout: "ADA" });
  });

  it("never joins the filterable or sortable defaults", async () => {
    const { crud } = await seeded({ computed: { shout } } as never);
    await expect(crud.findMany({ sort: [{ field: "shout" as never, direction: "asc" }] })).rejects.toBeInstanceOf(
      QueryValidationException,
    );
    await expect(crud.findMany(new WireQuery({ "filter[shout][eq]": "ADA" }) as never)).rejects.toBeInstanceOf(
      QueryValidationException,
    );
  });
});

describe("computed fields — bootstrap validation", () => {
  /**
   * Every config error names the entity, the key path and the offending
   * value (the bar `config-validation.spec.ts` sets) — `messageParams` is
   * where the first two live, so asserting the rendered message alone
   * would leave the key path free to drift.
   */
  const expectConfigError = (build: () => unknown, path: string, fragment: string, entity = "User") => {
    try {
      build();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationException);
      expect((error as ConfigurationException).code).toBe("KAVO_CONFIG_INVALID");
      expect((error as ConfigurationException).messageParams).toMatchObject({ entity, path });
      expect((error as ConfigurationException).message).toContain(fragment);
      return;
    }
    throw new Error("expected a ConfigurationException");
  };

  it("rejects a computed field listed as filterable", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout }, allowlists: { filterable: ["shout"] } } as never),
      "allowlists.filterable",
      "'shout' is a computed field on 'User', which can never be filtered on",
    );
  });

  it("rejects a computed field listed as sortable", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout }, allowlists: { sortable: ["shout"] } } as never),
      "allowlists.sortable",
      "'shout' is a computed field on 'User', which can never be sorted on",
    );
  });

  it("rejects a name that collides with a real column", () => {
    expectConfigError(
      () => makeCrud({ computed: { email: shout } } as never),
      "computed.email",
      "computed field 'email' collides with an existing column on 'User'",
    );
  });

  it("rejects a name that collides with a relation", () => {
    const kavo = createKavo();
    expectConfigError(
      () =>
        kavo.createCrud(Post, { computed: { author: { resolve: () => 1 } } } as never, {
          adapter: new SeededAdapter<Post>() as never,
          metadata: postMetadata as EntityMetadata<Post>,
        }),
      "computed.author",
      "computed field 'author' collides with an existing relation on 'Post'",
      "Post",
    );
  });

  it("rejects a descriptor with no resolve function", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout: {} } } as never),
      "computed.shout",
      "computed field 'shout' has no 'resolve' function",
    );
  });

  it("rejects an async resolve rather than emitting an unawaited promise", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout: { resolve: async () => "ADA" } } } as never),
      "computed.shout",
      "computed field 'shout' has an async 'resolve'",
    );
  });

  it("rejects `__proto__` as a name rather than losing the declaration", () => {
    // Assigning it into the accumulator would set that object's prototype
    // instead of adding a key, so the field would vanish with no error —
    // the same class of hazard as the filter parser's bracket segments.
    expectConfigError(
      () => makeCrud({ computed: { ["__proto__"]: shout } } as never),
      "computed.__proto__",
      "'__proto__' cannot name a computed field",
    );
  });

  it("still accepts an explicit selectable list naming the computed field", async () => {
    const { crud } = await seeded({
      computed: { shout },
      allowlists: { selectable: ["id", "shout"] },
    } as never);
    expect(await crud.findOne(1, { fields: ["shout"] } as never)).toEqual({ shout: "ADA" });
    await expect(crud.findOne(1, { fields: ["email"] } as never)).rejects.toBeInstanceOf(QueryValidationException);
  });

  it("lists the declared names in the debug dump", () => {
    const { kavo } = makeCrud({ computed: { shout } } as never);
    expect(kavo.describe("User")).toMatchObject({ computed: ["shout"] });
  });
});

describe("computed fields — a throwing or empty resolver", () => {
  it("surfaces a throwing resolver as a persistence failure, with the cause kept", async () => {
    // `resolve` is caller code running inside response mapping, after the
    // handler has already succeeded. Nothing in core catches it, so it
    // takes the engine's ordinary untranslated-error path.
    const boom = new Error("resolver exploded");
    const { crud, adapter } = makeCrud({
      computed: {
        shout: {
          resolve: () => {
            throw boom;
          },
        },
      },
    } as never);
    // Seeded through the adapter, not `createOne` — writes serialize their
    // result too, so a throwing resolver takes down the write as well.
    adapter.rows.push(Object.assign(new User(), { id: 1, name: "Ada" }));
    await expect(crud.findOne(1)).rejects.toMatchObject({
      code: "KAVO_PERSISTENCE_FAILED",
      status: 500,
      cause: boom,
    });
  });

  it("omits the key when a resolver returns undefined, and keeps an explicit null", async () => {
    // Same distinction the column branch draws: `undefined` is absence,
    // `null` is data — so the programmatic shape and the JSON body agree.
    const { crud } = await seeded({
      computed: {
        absent: { resolve: () => undefined },
        empty: { resolve: () => null },
      },
    } as never);
    const item = (await crud.findOne(1)) as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty("absent");
    expect(item).toHaveProperty("empty", null);
  });
});

describe("computed fields — never writable (ADR-0019)", () => {
  it("is stripped from a create body", async () => {
    const { crud, adapter } = makeCrud({ computed: { shout } } as never);
    const create = vi.spyOn(adapter, "create");
    await crud.createOne({ name: "Ada", email: "a@x.io", shout: "NOPE" } as never);
    expect(create.mock.calls[0]?.[0]).toEqual({ name: "Ada", email: "a@x.io" });
  });

  it("is stripped from update and patch bodies", async () => {
    const { crud, adapter } = await seeded({ computed: { shout } } as never);
    const update = vi.spyOn(adapter, "update");
    const patch = vi.spyOn(adapter, "patch");
    await crud.updateOne(1, { name: "Ada L", shout: "NOPE" } as never);
    await crud.patchOne(1, { shout: "NOPE" } as never);
    expect(update.mock.calls[0]?.[1]).toEqual({ name: "Ada L" });
    expect(patch.mock.calls[0]?.[1]).toEqual({});
  });

  it("stays stripped when a registered create DTO names it", async () => {
    // The derived writable projection alone is not enough: a registered DTO
    // *replaces* it (`dtoShapeKeys(dto) ?? this.writableProjection`), so
    // without the explicit strip this key would reach the adapter as if it
    // were a column.
    class CreateUserDto {
      name = "";
      shout = "";
    }
    const { crud, adapter } = makeCrud({ computed: { shout }, dto: { create: CreateUserDto } } as never);
    const create = vi.spyOn(adapter, "create");
    await crud.createOne({ name: "Ada", shout: "NOPE" } as never);
    expect(create.mock.calls[0]?.[0]).toEqual({ name: "Ada" });
  });

  it("is stripped by DefaultDeserializer directly, whichever projection is in force", () => {
    class UpdateUserDto {
      name = "";
      shout = "";
    }
    const computed: ComputedFieldMap<User> = { shout };
    const deserializer = new DefaultDeserializer<User>(userMetadata, undefined, computed);
    expect(deserializer.deserialize({ name: "Ada", shout: "NOPE" }, null, contextStub())).toEqual({ name: "Ada" });
    expect(deserializer.deserialize({ name: "Ada", shout: "NOPE" }, UpdateUserDto, contextStub())).toEqual({
      name: "Ada",
    });
  });
});

describe("computed fields — on an included relation target", () => {
  interface BlogConfigs {
    readonly author?: object;
    readonly post?: object;
    readonly comment?: object;
  }

  /**
   * `Author 1—* Post 1—* Comment`, so both include cardinalities are
   * reachable. Every entity gets a computed field named `label` with a
   * *different* resolver, which is what makes "each side uses its own
   * table" an assertion rather than an absence.
   */
  function blog(configs: BlogConfigs = {}) {
    const metadata = new Map<unknown, EntityMetadata<object>>([
      [Author, authorMetadata as EntityMetadata<object>],
      [Post, postMetadata as EntityMetadata<object>],
      [Comment, commentMetadata as EntityMetadata<object>],
    ]);
    const authorAdapter = new SeededAdapter<Author>([]);
    const postAdapter = new SeededAdapter<Post>([]);
    const adapters = new Map<unknown, unknown>([
      [Author, authorAdapter],
      [Post, postAdapter],
      [Comment, new SeededAdapter<Comment>([])],
    ]);
    const kavo = createKavo({
      infrastructure: {
        metadataFor: (entity) => metadata.get(entity) as never,
        adapterFor: (entity) => adapters.get(entity) as never,
      },
    });
    const authors = kavo.createCrud(
      Author,
      (configs.author ?? {
        computed: {
          initials: { resolve: (author: Author) => author.name.slice(0, 2) },
          label: { resolve: (author: Author) => `author:${author.name}` },
        },
        relations: { edges: { posts: { includable: true } } },
      }) as never,
    ) as DefaultKavoService<Author>;
    kavo.createCrud(
      Comment,
      (configs.comment ?? {
        computed: { label: { resolve: (comment: Comment) => `comment:${comment.body}` } },
      }) as never,
    );
    const posts = kavo.createCrud(
      Post,
      (configs.post ?? {
        computed: { label: { resolve: (post: Post) => `post:${post.title}` } },
        relations: { edges: { author: { includable: true }, comments: { includable: true } } },
      }) as never,
    ) as DefaultKavoService<Post>;
    postAdapter.rows.push(
      Object.assign(new Post(), {
        id: 10,
        title: "First",
        authorId: 1,
        author: Object.assign(new Author(), { id: 1, name: "Ada" }),
        comments: [Object.assign(new Comment(), { id: 100, body: "nice", postId: 10 })],
      }),
    );
    return { posts, authors, authorAdapter, postAdapter };
  }

  it("resolves the target's own computed field through the catalog", async () => {
    const { posts } = blog();
    const item = (await posts.findOne(10, { include: ["author"] })) as Post & {
      author: Author & { initials: string };
    };
    expect(item.author).toMatchObject({ id: 1, name: "Ada", initials: "Ad" });
  });

  it("honors the target's selectable allowlist for fields[author]", async () => {
    const { posts } = blog();
    const item = (await posts.findOne(10, {
      include: ["author"],
      fields: { author: ["initials"] },
    } as never)) as Post & { author: { initials: string } };
    expect(item.author).toEqual({ initials: "Ad" });
  });

  it("gives each side its own table when root and target share a field name", async () => {
    // `label` is declared on Post *and* on Author with different resolvers.
    // A serializer that reused the root projection's computed table for a
    // relation node would emit `author.label === "post:First"` here, which
    // is precisely the failure an absence assertion cannot see.
    const { posts } = blog();
    const item = (await posts.findOne(10, { include: ["author"] })) as Post & {
      label: string;
      author: { label: string };
    };
    expect(item.label).toBe("post:First");
    expect(item.author.label).toBe("author:Ada");
  });

  it("resolves a computed field on every element of a to-many include", async () => {
    // A to-many node reads the target's `list` DTO slot rather than `item`
    // — a distinct lookup in `projectionFor` that the to-one cases never
    // reach.
    const { posts } = blog();
    const item = (await posts.findOne(10, { include: ["comments"] })) as Post & {
      comments: Record<string, unknown>[];
    };
    expect(item.comments).toEqual([{ id: 100, body: "nice", postId: 10, label: "comment:nice" }]);
  });

  it("keeps evaluating a target computed field that the target's item DTO names", async () => {
    class AuthorItemDto {
      id = 0;
      initials = "";
    }
    const { posts } = blog({
      author: {
        computed: { initials: { resolve: (author: Author) => author.name.slice(0, 2) } },
        dto: { item: AuthorItemDto },
      },
    });
    const item = (await posts.findOne(10, { include: ["author"] })) as Post & { author: object };
    expect(item.author).toEqual({ id: 1, initials: "Ad" });
  });

  it("narrows a target computed field away when the target's item DTO omits it", async () => {
    class AuthorItemDto {
      id = 0;
      name = "";
    }
    const { posts } = blog({
      author: {
        computed: { initials: { resolve: (author: Author) => author.name.slice(0, 2) } },
        dto: { item: AuthorItemDto },
      },
    });
    const item = (await posts.findOne(10, { include: ["author"] })) as Post & { author: object };
    expect(item.author).toEqual({ id: 1, name: "Ada" });
  });

  it("hands a target's resolver the root request's context, not one of its own", async () => {
    // One response is one request, so there is only one context to give.
    // Documented on `ComputedFieldDescriptor.resolve` and in ADR-0019, and
    // pinned here so it cannot drift into a silent half-truth.
    let seen: KavoContext<Author> | null = null;
    const { posts } = blog({
      author: {
        computed: {
          initials: {
            resolve: (author: Author, context: KavoContext<Author>) => {
              seen = context;
              return author.name.slice(0, 2);
            },
          },
        },
      },
    });
    await posts.findOne(10, { include: ["author"] }, { principal: { id: "u-7" } });
    // Request-scoped members are the caller's, and true from anywhere …
    expect(seen).toMatchObject({ principal: { id: "u-7" } });
    // … while the entity-scoped ones describe the *root* operation.
    expect(seen).toMatchObject({ entityName: "Post", operation: "findOne" });
  });
});
