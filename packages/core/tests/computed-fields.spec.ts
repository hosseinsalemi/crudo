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
    expect(await crud.findOne(1)).toMatchObject({ shout: "ADA" });
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
  const expectConfigError = (build: () => unknown, fragment: string) => {
    try {
      build();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationException);
      expect((error as ConfigurationException).code).toBe("KAVO_CONFIG_INVALID");
      expect((error as ConfigurationException).message).toContain(fragment);
      return;
    }
    throw new Error("expected a ConfigurationException");
  };

  it("rejects a computed field listed as filterable", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout }, allowlists: { filterable: ["shout"] } } as never),
      "'shout' is a computed field on 'User', which can never be filtered on",
    );
  });

  it("rejects a computed field listed as sortable", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout }, allowlists: { sortable: ["shout"] } } as never),
      "'shout' is a computed field on 'User', which can never be sorted on",
    );
  });

  it("rejects a name that collides with a real column", () => {
    expectConfigError(
      () => makeCrud({ computed: { email: shout } } as never),
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
      "computed field 'author' collides with an existing relation on 'Post'",
    );
  });

  it("rejects a descriptor with no resolve function", () => {
    expectConfigError(
      () => makeCrud({ computed: { shout: {} } } as never),
      "computed field 'shout' has no 'resolve' function",
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
  /** `Post *—1 Author`, with the computed field declared on the *target*. */
  function blog() {
    const metadata = new Map<unknown, EntityMetadata<object>>([
      [Author, authorMetadata as EntityMetadata<object>],
      [Post, postMetadata as EntityMetadata<object>],
      [Comment, commentMetadata as EntityMetadata<object>],
    ]);
    const postAdapter = new SeededAdapter<Post>([]);
    const adapters = new Map<unknown, unknown>([
      [Author, new SeededAdapter<Author>([])],
      [Post, postAdapter],
      [Comment, new SeededAdapter<Comment>([])],
    ]);
    const kavo = createKavo({
      infrastructure: {
        metadataFor: (entity) => metadata.get(entity) as never,
        adapterFor: (entity) => adapters.get(entity) as never,
      },
    });
    kavo.createCrud(Author, {
      computed: { initials: { resolve: (author: Author) => author.name.slice(0, 2) } },
    } as never);
    const posts = kavo.createCrud(Post, {
      relations: { edges: { author: { includable: true } } },
    } as never) as DefaultKavoService<Post>;
    postAdapter.rows.push(
      Object.assign(new Post(), {
        id: 10,
        title: "First",
        authorId: 1,
        author: Object.assign(new Author(), { id: 1, name: "Ada" }),
      }),
    );
    return { posts };
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

  it("never emits a root computed field onto an included relation", async () => {
    const { posts } = blog();
    const item = (await posts.findOne(10, { include: ["author"] })) as Post & { author: Record<string, unknown> };
    expect(item.author).not.toHaveProperty("shout");
  });
});
