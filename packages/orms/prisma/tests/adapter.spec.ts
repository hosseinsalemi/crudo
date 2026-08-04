import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ConflictException,
  NotFoundException,
  PersistenceException,
  QueryValidationException,
  type KavoInstance,
  type DefaultKavoService,
} from "@kavo/core";
import { buildEntityMetadata, createPrismaKavo } from "@kavo/prisma";
import { newTestPrismaClient } from "./support/client.js";

// Marker classes: Prisma models have no runtime class of their own, so
// these exist purely as the `ClassRef` identity `createCrud` needs,
// matched to the schema's `model Author { … }` / `model Book { … }` by
// name. See the doc comment on `buildEntityMetadata`.
class Author {
  id!: number;
  email!: string;
  name!: string;
  age!: number;
  status!: string;
  bio!: string | null;
  role!: string;
  createdAt!: Date;
  books?: Book[];
}

class Book {
  id!: number;
  title!: string;
  authorId!: number | null;
}

let client: PrismaClient;
let kavo: KavoInstance;
let authors: DefaultKavoService<Author>;

beforeAll(() => {
  client = newTestPrismaClient();
  kavo = createPrismaKavo(client as never, {
    datamodel: Prisma.dmmf.datamodel,
    entities: [Author, Book],
    caseInsensitiveFilters: false, // SQLite rejects Prisma's `mode: "insensitive"`
  });
  authors = kavo.createCrud(Author) as DefaultKavoService<Author>;
});

afterAll(async () => {
  await client.$disconnect();
});

beforeEach(async () => {
  await client.book.deleteMany();
  await client.author.deleteMany();
});

async function seed(): Promise<void> {
  const rows = [
    { email: "ada@x.io", name: "Ada", age: 36, status: "active" },
    { email: "grace@x.io", name: "Grace", age: 45, status: "active" },
    { email: "alan@x.io", name: "Alan", age: 41, status: "banned" },
    { email: "joan@x.io", name: "Joan", age: 28, status: "pending" },
  ];
  for (const row of rows) await authors.createOne(row as never);
}

describe("metadata derivation seam", () => {
  it("derives fields, id, generated flags, and relations", () => {
    const metadata = buildEntityMetadata(Prisma.dmmf.datamodel, Author, new Map([["Book", Book] as const]));
    expect(metadata.name).toBe("Author");
    expect(metadata.idField).toBe("id");
    const byName = Object.fromEntries(metadata.fields.map((f) => [f.name, f]));
    expect(byName["id"]).toMatchObject({ kind: "number", generated: true });
    expect(byName["email"]).toMatchObject({ kind: "string", generated: false });
    expect(byName["createdAt"]).toMatchObject({ kind: "date", generated: true });
    expect(byName["status"]).toMatchObject({ kind: "string", generated: false });
    expect(byName["bio"]).toMatchObject({ nullable: true });
    expect(byName["role"]).toMatchObject({ kind: "enum", generated: false, enumValues: ["ADMIN", "MEMBER"] });
    expect(byName["books"]).toBeUndefined(); // relations are not fields
    expect(metadata.relations.map((r) => r.name)).toEqual(["books"]);
    expect(metadata.relations[0]).toMatchObject({ cardinality: "many", includable: false });
  });
});

describe("PrismaRepositoryAdapter — CRUD", () => {
  it("creates, reads, updates, patches, deletes against the real database", async () => {
    const created = await authors.createOne({ email: "ada@x.io", name: "Ada", age: 36 } as never);
    expect(created).toMatchObject({ name: "Ada", status: "active", role: "MEMBER" });
    const id = (created as Author).id;

    const fetched = await authors.findOne(id);
    expect(fetched).toMatchObject({ email: "ada@x.io" });

    await authors.updateOne(id, { email: "ada@x.io", name: "Ada L", age: 37 } as never);
    const patched = await authors.patchOne(id, { age: 38 } as never);
    expect(patched).toMatchObject({ name: "Ada L", age: 38 });

    await authors.deleteOne(id);
    await expect(authors.findOne(id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFound for updates/deletes on missing rows", async () => {
    await expect(authors.updateOne(4242, { name: "x" } as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(authors.deleteOne(4242)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps unique violations to ConflictException (error-mapping table)", async () => {
    await authors.createOne({ email: "dup@x.io", name: "A", age: 1 } as never);
    await expect(authors.createOne({ email: "dup@x.io", name: "B", age: 2 } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("PrismaRepositoryAdapter — query translation", () => {
  it("filters, sorts, and paginates in the database", async () => {
    await seed();
    const list = await authors.findMany({
      filter: { kind: "condition", field: "status", operator: "EQ", value: "active" },
      sort: [{ field: "age", direction: "desc" }],
      limit: 1,
      offset: 1,
    });
    expect(list.items.map((a) => (a as Author).name)).toEqual(["Ada"]);
    expect(list.total).toBe(2); // total counts all matches, not the page
    expect(list.limit).toBe(1);
    expect(list.offset).toBe(1);
  });

  it("translates OR groups and NOT nodes", async () => {
    await seed();
    const either = await authors.findMany({
      filter: {
        kind: "group",
        operator: "OR",
        children: [
          { kind: "condition", field: "name", operator: "EQ", value: "Ada" },
          { kind: "condition", field: "status", operator: "EQ", value: "banned" },
        ],
      },
      sort: [{ field: "name", direction: "asc" }],
    });
    expect(either.items.map((a) => (a as Author).name)).toEqual(["Ada", "Alan"]);

    const negated = await authors.findMany({
      filter: {
        kind: "group",
        operator: "NOT",
        children: [{ kind: "condition", field: "status", operator: "EQ", value: "active" }],
      },
      sort: [{ field: "age", direction: "asc" }],
    });
    expect(negated.items.map((a) => (a as Author).name)).toEqual(["Joan", "Alan"]);
  });

  it("translates IN, BETWEEN, LIKE, ILIKE and null checks", async () => {
    await seed();
    await authors.patchOne(
      (await authors.findMany()).items.map((a) => a as Author).find((a) => a.name === "Joan")!.id,
      { bio: "wrote code" } as never,
    );

    const inSet = await authors.findMany({
      filter: { kind: "condition", field: "status", operator: "IN", value: ["banned", "pending"] },
    });
    expect(inSet.items).toHaveLength(2);

    const between = await authors.findMany({
      filter: { kind: "condition", field: "age", operator: "BETWEEN", value: [40, 50] },
    });
    expect(between.items.map((a) => (a as Author).name).sort()).toEqual(["Alan", "Grace"]);

    const like = await authors.findMany({
      filter: { kind: "condition", field: "name", operator: "LIKE", value: "A%" },
    });
    expect(like.items.map((a) => (a as Author).name).sort()).toEqual(["Ada", "Alan"]);

    const ilike = await authors.findMany({
      filter: { kind: "condition", field: "name", operator: "ILIKE", value: "a%" },
    });
    expect(ilike.items.map((a) => (a as Author).name).sort()).toEqual(["Ada", "Alan"]);

    const withBio = await authors.findMany({
      filter: { kind: "condition", field: "bio", operator: "IS_NOT_NULL", value: true },
    });
    expect(withBio.items.map((a) => (a as Author).name)).toEqual(["Joan"]);
  });

  it("matches nothing on an empty IN set instead of erroring", async () => {
    await seed();
    const list = await authors.findMany({
      filter: { kind: "condition", field: "status", operator: "IN", value: [] },
    });
    expect(list.items).toHaveLength(0);
  });

  it("applies the configured defaultSort when the caller supplies no sort", async () => {
    await seed();
    const withDefault = kavo.createCrud(Author, {
      query: { defaultSort: [{ field: "age", direction: "asc" }] },
    }) as DefaultKavoService<Author>;
    const list = await withDefault.findMany();
    expect(list.items.map((a) => (a as Author).name)).toEqual(["Joan", "Ada", "Alan", "Grace"]);
  });

  it("lets a caller-supplied sort override the configured defaultSort", async () => {
    await seed();
    const withDefault = kavo.createCrud(Author, {
      query: { defaultSort: [{ field: "age", direction: "asc" }] },
    }) as DefaultKavoService<Author>;
    const list = await withDefault.findMany({ sort: [{ field: "age", direction: "desc" }] });
    expect(list.items.map((a) => (a as Author).name)).toEqual(["Grace", "Alan", "Ada", "Joan"]);
  });

  it("skips the count query when counting is disabled", async () => {
    await seed();
    const list = await authors.findMany(undefined, { settings: { pagination: { count: false } } });
    expect(list.total).toBeNull();
    expect(list.items).toHaveLength(4);
  });

  it("refuses an operator outside the AST enum rather than dropping the predicate", async () => {
    await seed();
    await expect(
      authors.findMany({
        filter: { kind: "condition", field: "status", operator: "SOUNDS_LIKE" as never, value: "active" },
      }),
    ).rejects.toBeInstanceOf(PersistenceException);
  });

  it("still rejects non-allowlisted programmatic filters", async () => {
    await expect(
      authors.findMany({
        filter: { kind: "condition", field: "books.title" as never, operator: "EQ", value: "x" },
      }),
    ).rejects.toBeInstanceOf(QueryValidationException);
  });

  it("filters on relation paths when explicitly allowlisted", async () => {
    const scoped = kavo.createCrud(Book, {
      allowlists: { filterable: ["title", "author.name" as never] },
    }) as DefaultKavoService<Book>;
    await seed();
    const ada = (await authors.findMany()).items.map((a) => a as Author).find((a) => a.name === "Ada")!;
    await client.book.create({ data: { title: "Notes", authorId: ada.id } });
    await client.book.create({ data: { title: "Other", authorId: ada.id + 1 } });

    const list = await scoped.findMany({
      filter: { kind: "condition", field: "author.name" as never, operator: "EQ", value: "Ada" },
    });
    expect(list.items.map((b) => (b as Book).title)).toEqual(["Notes"]);
  });

  it("filters on a to-many relation path, restricting root rows rather than 500ing", async () => {
    // Prisma requires `some`/`every`/`none` on a list relation and rejects
    // the bare nested form with `Unknown argument`, which reached the client
    // as a 500 (#116). doc 05 §3 defines a relation-path filter as
    // restricting root rows — "an author with at least one book titled X" —
    // which is `some`.
    const scoped = kavo.createCrud(Author, {
      allowlists: { filterable: ["name", "books.title" as never] },
    }) as DefaultKavoService<Author>;
    await seed();
    const all = (await authors.findMany()).items.map((a) => a as Author);
    const ada = all.find((a) => a.name === "Ada")!;
    const grace = all.find((a) => a.name === "Grace")!;
    await client.book.create({ data: { title: "Notes", authorId: ada.id } });
    await client.book.create({ data: { title: "Other", authorId: grace.id } });

    const list = await scoped.findMany({
      filter: { kind: "condition", field: "books.title" as never, operator: "EQ", value: "Notes" },
    });
    expect(list.items.map((a) => (a as Author).name)).toEqual(["Ada"]);
  });

  it("associates a relation by writing its scalar foreign-key field (ADR-0014)", async () => {
    const books = kavo.createCrud(Book, {
      relations: { edges: { author: { includable: true } } },
    } as never) as DefaultKavoService<Book>;
    const author = (await authors.createOne({ email: "assoc@x.io", name: "Assoc", age: 1 } as never)) as Author;

    const created = (await books.createOne({ title: "Assoc Book", authorId: author.id } as never)) as Book;
    expect(created).toMatchObject({ title: "Assoc Book", authorId: author.id });

    const fetched = await books.findOne(created.id, { include: ["author"] } as never);
    expect(fetched).toMatchObject({ author: { id: author.id, name: "Assoc" } });
  });
});

/**
 * The corners of the grammar that only a real engine can settle: what
 * Prisma actually does with the degenerate empty groups (#111 left the
 * `NOT []` cell of the cross-adapter table unverified), and whether the
 * translated `LIKE` filters match the rows SQL `LIKE` would.
 */
describe("PrismaRepositoryAdapter — grammar corners against a real engine", () => {
  const empty = (operator: "AND" | "OR" | "NOT") =>
    authors.findMany({ filter: { kind: "group", operator, children: [] } as never });

  it("agrees with the other three adapters on every degenerate empty group", async () => {
    await seed(); // four rows
    // Identity of conjunction is `true`, of disjunction `false`; `NOT []` is
    // `NOT(AND [])`, so it negates the tautology. doc 05 §3.
    expect((await empty("AND")).items).toHaveLength(4);
    expect((await empty("OR")).items).toHaveLength(0);
    expect((await empty("NOT")).items).toHaveLength(0);
  });

  it("excludes rows matching every child of a multi-child NOT", async () => {
    // `NOT(AND(children))` (doc 05 §1). Negating only `children[0]` would
    // have kept Ada out on her name alone and let the second condition go.
    await seed();
    const list = await authors.findMany({
      filter: {
        kind: "group",
        operator: "NOT",
        children: [
          { kind: "condition", field: "name", operator: "EQ", value: "Ada" },
          { kind: "condition", field: "age", operator: "EQ", value: 36 },
        ],
      } as never,
    });
    // Only Ada is both named Ada and 36, so only Ada is excluded.
    expect(list.items.map((a) => (a as Author).name).sort()).toEqual(["Alan", "Grace", "Joan"]);
  });

  it("matches a literal % through the backslash escape, not rows beginning with a backslash", async () => {
    // The grammar's `\%` escape (doc 05 §3) is what the other three adapters
    // honor; Prisma used to leave the backslash in the operand (#114).
    await authors.createOne({ email: "pct@x.io", name: "100%", age: 1 } as never);
    await authors.createOne({ email: "plain@x.io", name: "1000", age: 1 } as never);

    const list = await authors.findMany({
      filter: { kind: "condition", field: "name", operator: "LIKE", value: "100\\%" },
    });
    expect(list.items.map((a) => (a as Author).name)).toEqual(["100%"]);
  });

  it("rejects a pattern Prisma cannot express with a 400, not a driver error", async () => {
    await seed();
    await expect(
      authors.findMany({ filter: { kind: "condition", field: "name", operator: "LIKE", value: "A%a" } }),
    ).rejects.toBeInstanceOf(QueryValidationException);
  });
});
