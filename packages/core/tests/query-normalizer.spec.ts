import { describe, expect, it } from "vitest";
import type { ClassRef, EntityMetadata } from "@kavo/core";
import { DefaultEntityCatalog, DefaultIncludeResolver, QueryNormalizer, resolveEntityConfig } from "@kavo/core";
import { userMetadata } from "./support/user-fixture.js";
import { accountMetadata } from "./support/account-fixture.js";
import type { Post } from "./support/blog-fixture.js";
import { Author, Comment, authorMetadata, commentMetadata, postMetadata } from "./support/blog-fixture.js";
import { issuesOf } from "./support/query-issues.js";

const config = resolveEntityConfig(userMetadata, undefined, undefined);
const normalizer = new QueryNormalizer(userMetadata);

const softDeletableConfig = resolveEntityConfig(accountMetadata, undefined, undefined);
const softDeletableNormalizer = new QueryNormalizer(accountMetadata);

/**
 * `Post` is the one fixture that is both soft-deletable (`deletedAt`) and
 * relation-bearing, so it is the only place the whole grammar — filter,
 * sort, pagination, root and relation fieldsets, includes, and the
 * soft-delete flags — can meet in a single normalized request.
 */
const postCatalog = new DefaultEntityCatalog((entity: ClassRef) => {
  if (entity === Comment) return commentMetadata as unknown as EntityMetadata<object>;
  if (entity === Author) return authorMetadata as unknown as EntityMetadata<object>;
  return undefined;
});
const postConfig = resolveEntityConfig(
  postMetadata,
  { relations: { edges: { comments: { includable: true } } } },
  undefined,
);
const postNormalizer = new QueryNormalizer<Post>(postMetadata, [], new DefaultIncludeResolver<Post>(postCatalog));

describe("QueryNormalizer — wire params", () => {
  it("normalizes the full reference query", () => {
    const query = normalizer.normalizeWire(
      {
        "filter[age][gte]": "18",
        sort: "-createdAt,name",
        limit: "20",
        offset: "20",
        fields: "id,name,email",
      },
      config,
    );
    expect(query.filter.root).toMatchObject({ operator: "GTE", value: 18 });
    expect(query.sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);
    expect(query.pagination).toEqual({ limit: 20, offset: 20 });
    expect(query.fields.root).toEqual(["id", "name", "email"]);
    expect(query.include).toEqual({});
    expect(query.withDeleted).toBe(false);
    expect(query.count).toBe(true);
  });

  it("applies defaultLimit and clamps to maxLimit", () => {
    const defaulted = normalizer.normalizeWire({}, config);
    expect(defaulted.pagination).toEqual({ limit: 20, offset: 0 });
    const clamped = normalizer.normalizeWire({ limit: "9999" }, config);
    expect(clamped.pagination.limit).toBe(100);
  });

  it("issues no sort at all when neither the client nor config supplies one", () => {
    expect(normalizer.normalizeWire({}, config).sort).toEqual([]);
  });

  it("rejects malformed pagination values", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ limit: "abc" }, config));
    expect(issues[0]).toMatchObject({
      field: "limit",
      code: "KAVO_QUERY_INVALID_VALUE",
    });
  });

  it("rejects non-sortable fields", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ sort: "-password" }, config));
    expect(issues[0]).toMatchObject({
      field: "password",
      code: "KAVO_QUERY_INVALID_FIELD",
    });
  });

  // Both features ship; this normalizer is built without an include
  // resolver and against a config that does not declare soft delete, so
  // asking for either is unsupported *here* rather than unimplemented.
  it("rejects include and withDeleted=true when neither is configured", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ include: "posts", withDeleted: "true" }, config));
    const codes = issues.map((issue) => issue.code);
    expect(codes).toEqual(["KAVO_QUERY_UNSUPPORTED_PARAM", "KAVO_QUERY_UNSUPPORTED_PARAM"]);
  });

  it("accepts withDeleted=false (the default) without complaint", () => {
    const query = normalizer.normalizeWire({ withDeleted: "false" }, config);
    expect(query.withDeleted).toBe(false);
  });

  it("collects issues across sections in one exception", () => {
    const issues = issuesOf(() =>
      normalizer.normalizeWire(
        {
          "filter[password][eq]": "x",
          sort: "-password",
          fields: "password",
        },
        config,
      ),
    );
    expect(issues).toHaveLength(3);
  });

  it("honors the page strategy when configured", () => {
    const paged = resolveEntityConfig(userMetadata, { pagination: { strategy: "page" } }, undefined);
    const query = normalizer.normalizeWire({ "page[number]": "3", "page[size]": "10" }, paged);
    expect(query.pagination).toEqual({ limit: 10, offset: 20 });
  });

  it("honors pagination.count=false", () => {
    const uncounted = resolveEntityConfig(userMetadata, { pagination: { count: false } }, undefined);
    expect(normalizer.normalizeWire({}, uncounted).count).toBe(false);
  });

  it("falls back to the configured defaultSort when the client supplies no sort", () => {
    const defaulted = resolveEntityConfig(
      userMetadata,
      { query: { defaultSort: [{ field: "createdAt", direction: "desc" }] } },
      undefined,
    );
    expect(normalizer.normalizeWire({}, defaulted).sort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  it("applies a multi-field defaultSort in priority order", () => {
    const defaulted = resolveEntityConfig(
      userMetadata,
      {
        query: {
          defaultSort: [
            { field: "createdAt", direction: "desc" },
            { field: "id", direction: "asc" },
          ],
        },
      },
      undefined,
    );
    expect(normalizer.normalizeWire({}, defaulted).sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "id", direction: "asc" },
    ]);
  });

  it("lets a client-supplied sort override the configured defaultSort outright", () => {
    const defaulted = resolveEntityConfig(
      userMetadata,
      { query: { defaultSort: [{ field: "createdAt", direction: "desc" }] } },
      undefined,
    );
    expect(normalizer.normalizeWire({ sort: "name" }, defaulted).sort).toEqual([{ field: "name", direction: "asc" }]);
  });
});

describe("QueryNormalizer — onlyDeleted", () => {
  it("rejects onlyDeleted=true when the entity is not soft-deletable (wire)", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ onlyDeleted: "true" }, config));
    expect(issues[0]).toMatchObject({ field: "onlyDeleted", code: "KAVO_QUERY_UNSUPPORTED_PARAM" });
  });

  it("rejects onlyDeleted=true when the entity is not soft-deletable (programmatic)", () => {
    const issues = issuesOf(() => normalizer.normalizeInput({ onlyDeleted: true }, config));
    expect(issues[0]).toMatchObject({ field: "onlyDeleted", code: "KAVO_QUERY_UNSUPPORTED_PARAM" });
  });

  it("accepts onlyDeleted=true on a soft-deletable entity (wire)", () => {
    const query = softDeletableNormalizer.normalizeWire({ onlyDeleted: "true" }, softDeletableConfig);
    expect(query.onlyDeleted).toBe(true);
    expect(query.withDeleted).toBe(false);
  });

  it("accepts onlyDeleted=true on a soft-deletable entity (programmatic)", () => {
    const query = softDeletableNormalizer.normalizeInput({ onlyDeleted: true }, softDeletableConfig);
    expect(query.onlyDeleted).toBe(true);
    expect(query.withDeleted).toBe(false);
  });

  it("rejects withDeleted and onlyDeleted set together (wire)", () => {
    const issues = issuesOf(() =>
      softDeletableNormalizer.normalizeWire({ withDeleted: "true", onlyDeleted: "true" }, softDeletableConfig),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ field: "onlyDeleted", code: "KAVO_QUERY_CONFLICTING_PARAMS" }),
    );
  });

  it("rejects withDeleted and onlyDeleted set together (programmatic)", () => {
    const issues = issuesOf(() =>
      softDeletableNormalizer.normalizeInput({ withDeleted: true, onlyDeleted: true }, softDeletableConfig),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ field: "onlyDeleted", code: "KAVO_QUERY_CONFLICTING_PARAMS" }),
    );
  });

  it("rejects a non-boolean onlyDeleted value", () => {
    const issues = issuesOf(() => softDeletableNormalizer.normalizeWire({ onlyDeleted: "yes" }, softDeletableConfig));
    expect(issues[0]).toMatchObject({ field: "onlyDeleted", code: "KAVO_QUERY_INVALID_VALUE" });
  });
});

/**
 * Every feature below is individually covered above; what these pin down is
 * that they compose. Each section of the pipeline writes into one shared
 * issue list and one shared result, so a regression that lets one section
 * clobber another's output — or short-circuit the sections after it — is
 * invisible to any single-feature test.
 */
describe("QueryNormalizer — the whole grammar in one request", () => {
  const wire = {
    "filter[title][like]": "%draft%",
    "filter[authorId][eq]": "7",
    sort: "-id,title",
    limit: "5",
    offset: "10",
    fields: "id,title",
    "fields[comments]": "id,body",
    include: "comments",
    onlyDeleted: "true",
  };

  it("normalizes filter, sort, pagination, fields, include and onlyDeleted together", () => {
    const query = postNormalizer.normalizeWire(wire, postConfig);

    expect(query.filter.root).toMatchObject({
      kind: "group",
      operator: "AND",
      children: [
        { field: "title", operator: "LIKE", value: "%draft%" },
        { field: "authorId", operator: "EQ", value: 7 },
      ],
    });
    expect(query.sort).toEqual([
      { field: "id", direction: "desc" },
      { field: "title", direction: "asc" },
    ]);
    expect(query.pagination).toEqual({ limit: 5, offset: 10 });
    expect(query.fields).toEqual({ root: ["id", "title"], relations: { comments: ["id", "body"] } });
    expect(query.onlyDeleted).toBe(true);
    expect(query.withDeleted).toBe(false);
    expect(query.count).toBe(true);
  });

  it("resolves the include tree in the same pass, fieldset attached", () => {
    const query = postNormalizer.normalizeWire(wire, postConfig);
    expect(Object.keys(query.include)).toEqual(["comments"]);
    expect(query.include["comments"]).toMatchObject({
      path: "comments",
      fields: ["id", "body"],
      strategy: "batch",
    });
  });

  it("still collects issues from every section when they are combined", () => {
    // Distinct bad names per section on purpose: with one shared name the
    // three `KAVO_QUERY_INVALID_FIELD` issues are indistinguishable, so a
    // regression where one section double-reported while another stopped
    // reporting would produce the same multiset and pass.
    const issues = issuesOf(() =>
      postNormalizer.normalizeWire(
        { ...wire, "filter[secretA][eq]": "x", sort: "-secretB", fields: "secretC", limit: "abc" },
        postConfig,
      ),
    );
    expect(issues).toEqual([
      expect.objectContaining({ field: "secretA", code: "KAVO_QUERY_INVALID_FIELD" }),
      expect.objectContaining({ field: "secretB", code: "KAVO_QUERY_INVALID_FIELD" }),
      expect.objectContaining({ field: "secretC", code: "KAVO_QUERY_INVALID_FIELD" }),
      expect.objectContaining({ field: "limit", code: "KAVO_QUERY_INVALID_VALUE" }),
    ]);
  });
});

/**
 * A trash view is still a read: narrowing the root to soft-deleted rows must
 * not change what `include=` resolves to. The flags and the include resolver
 * are separate branches of `normalizeWire`, and the include branch runs
 * before pagination — so a flag that short-circuited would silently strip
 * relations from exactly the view that needs them most.
 */
describe("QueryNormalizer — include under the soft-delete flags", () => {
  it("resolves the same include tree for a live, withDeleted, and onlyDeleted read", () => {
    const live = postNormalizer.normalizeWire({ include: "comments" }, postConfig);
    const withDeleted = postNormalizer.normalizeWire({ include: "comments", withDeleted: "true" }, postConfig);
    const onlyDeleted = postNormalizer.normalizeWire({ include: "comments", onlyDeleted: "true" }, postConfig);

    expect(Object.keys(live.include)).toEqual(["comments"]);
    expect(withDeleted.include).toEqual(live.include);
    expect(onlyDeleted.include).toEqual(live.include);
    expect([live.withDeleted, live.onlyDeleted]).toEqual([false, false]);
    expect([withDeleted.withDeleted, withDeleted.onlyDeleted]).toEqual([true, false]);
    expect([onlyDeleted.withDeleted, onlyDeleted.onlyDeleted]).toEqual([false, true]);
  });

  it("reports the include failure and the flag conflict in one exception", () => {
    const issues = issuesOf(() =>
      postNormalizer.normalizeWire({ include: "ghosts", withDeleted: "true", onlyDeleted: "true" }, postConfig),
    );
    expect(issues).toContainEqual(expect.objectContaining({ field: "ghosts", code: "KAVO_QUERY_INVALID_FIELD" }));
    expect(issues).toContainEqual(
      expect.objectContaining({ field: "onlyDeleted", code: "KAVO_QUERY_CONFLICTING_PARAMS" }),
    );
  });
});

describe("QueryNormalizer — programmatic input", () => {
  it("normalizes typed QueryContext input without coercion", () => {
    const query = normalizer.normalizeInput(
      {
        filter: { kind: "condition", field: "age", operator: "GTE", value: 18 },
        sort: [{ field: "name", direction: "asc" }],
        limit: 5,
      },
      config,
    );
    expect(query.filter.root).toMatchObject({ value: 18 });
    expect(query.pagination).toEqual({ limit: 5, offset: 0 });
  });

  it("issues no sort at all when neither the caller nor config supplies one", () => {
    expect(normalizer.normalizeInput({}, config).sort).toEqual([]);
  });

  it("enforces allowlists identically to the wire path", () => {
    const issues = issuesOf(() =>
      normalizer.normalizeInput(
        {
          filter: {
            kind: "condition",
            // Runtime strings can defeat FieldPath typing; the allowlist
            // must still hold.
            field: "password" as never,
            operator: "EQ",
            value: "x",
          },
        },
        config,
      ),
    );
    expect(issues[0]?.code).toBe("KAVO_QUERY_INVALID_FIELD");
  });

  it("falls back to the configured defaultSort when no sort is given", () => {
    const defaulted = resolveEntityConfig(
      userMetadata,
      { query: { defaultSort: [{ field: "createdAt", direction: "desc" }] } },
      undefined,
    );
    expect(normalizer.normalizeInput({}, defaulted).sort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  it("lets a caller-supplied sort override the configured defaultSort outright", () => {
    const defaulted = resolveEntityConfig(
      userMetadata,
      { query: { defaultSort: [{ field: "createdAt", direction: "desc" }] } },
      undefined,
    );
    const query = normalizer.normalizeInput({ sort: [{ field: "name", direction: "asc" }] }, defaulted);
    expect(query.sort).toEqual([{ field: "name", direction: "asc" }]);
  });
});

/**
 * `FieldSelectionInput` accepts three spellings so programmatic callers can
 * write what the wire format looks like. They are sugar and nothing more:
 * each must collapse to the *same* `NormalizedQueryContext` before the
 * engine or any adapter sees it, and each must face the same validation.
 */
describe("QueryNormalizer — the three fields spellings", () => {
  it("collapses root-only sugar and the structured form to one selection", () => {
    const sugar = normalizer.normalizeInput({ fields: ["id", "name"] }, config);
    const structured = normalizer.normalizeInput({ fields: { root: ["id", "name"] } }, config);

    expect(sugar.fields).toEqual({ root: ["id", "name"], relations: {} });
    expect(sugar).toEqual(structured);
  });

  it("treats an omitted and an empty selection alike", () => {
    const omitted = normalizer.normalizeInput({}, config);
    expect(omitted.fields).toEqual({ root: null, relations: {} });
    expect(normalizer.normalizeInput({ fields: {} }, config)).toEqual(omitted);
  });

  it("reads a relation-keyed selection as relations, not as root fields", () => {
    // No include resolver here, so a relation fieldset is *unsupported* —
    // which is exactly the tell that `{ posts: [...] }` was routed to
    // `relations` rather than misread as a root field list.
    const relationKeyed = issuesOf(() => normalizer.normalizeInput({ fields: { posts: ["title"] } }, config));
    const structured = issuesOf(() =>
      normalizer.normalizeInput({ fields: { relations: { posts: ["title"] } } }, config),
    );

    expect(relationKeyed).toEqual(structured);
    expect(relationKeyed[0]).toMatchObject({
      field: "include",
      code: "KAVO_QUERY_UNSUPPORTED_PARAM",
    });
  });

  it("rejects a non-allowlisted root field in either root spelling", () => {
    for (const fields of [["password"], { root: ["password"] }] as const) {
      const issues = issuesOf(() => normalizer.normalizeInput({ fields } as never, config));
      expect(issues[0]).toMatchObject({
        field: "password",
        code: "KAVO_QUERY_INVALID_FIELD",
      });
    }
  });

  // Runtime strings can defeat every one of these; the type system is not
  // the only gate, and a malformed `fields` value must never throw — that
  // would surface as a 500, not a 400.
  it("reports a non-object fields value as a query issue rather than throwing", () => {
    for (const bad of [null, "id,name", 42, true]) {
      const issues = issuesOf(() => normalizer.normalizeInput({ fields: bad } as never, config));
      expect(issues[0]).toMatchObject({
        field: "fields",
        code: "KAVO_QUERY_INVALID_VALUE",
      });
    }
  });

  it("rejects mixing the structured and relation-keyed spellings rather than dropping the relation fieldset", () => {
    const issues = issuesOf(() =>
      normalizer.normalizeInput({ fields: { root: ["id"], posts: ["title"] } } as never, config),
    );
    expect(issues[0]).toMatchObject({
      field: "fields.posts",
      code: "KAVO_QUERY_INVALID_VALUE",
    });
  });
});

/**
 * Issue #7: an allowlist rejection named what was refused and stopped
 * there, leaving the developer to guess which config key would permit it.
 * The leading sentence is unchanged; everything actionable is appended, so
 * these assert the appended clause and never the whole string.
 */
describe("allowlist rejection messages", () => {
  it("names the near miss, the permitted set, and the config key for a filter field", () => {
    const detail = issuesOf(() => normalizer.normalizeWire({ "filter[emial][eq]": "a" }, config))[0]!.detail;
    expect(detail).toContain("Field 'emial' cannot be used for filtering.");
    expect(detail).toContain("Did you mean 'email'?");
    expect(detail).toContain("Filterable fields on User:");
    expect(detail).toContain("add it to allowlists.filterable on the User config to permit it.");
  });

  it("stops appending the hint once a request is past a handful of problems", () => {
    // `?fields=a1,…,a5000` is a legal query string, and the hint is not
    // free: it walks the whole allowlist per rejected name and adds a few
    // hundred bytes per issue. Uncapped, one request becomes a megabyte of
    // prose and an O(names × allowlist) sweep. The leading sentence — the
    // part that says what was refused — is never dropped.
    const many = Array.from({ length: 200 }, (_unused, index) => `bad${index}`).join(",");
    const issues = issuesOf(() => normalizer.normalizeWire({ fields: many }, config));
    expect(issues).toHaveLength(200);
    expect(issues.every((issue) => issue.detail.includes("cannot be used for selection"))).toBe(true);
    expect(issues.filter((issue) => issue.detail.includes("allowlists.selectable"))).toHaveLength(5);
    expect(issues[199]!.detail).toBe("Field 'bad199' cannot be used for selection.");
  });

  it("names allowlists.sortable for a sort field", () => {
    const detail = issuesOf(() => normalizer.normalizeWire({ sort: "-emial" }, config))[0]!.detail;
    expect(detail).toContain("Did you mean 'email'?");
    expect(detail).toContain("allowlists.sortable on the User config");
  });

  it("names allowlists.selectable for a selected field", () => {
    const detail = issuesOf(() => normalizer.normalizeWire({ fields: "emial" }, config))[0]!.detail;
    expect(detail).toContain("Did you mean 'email'?");
    expect(detail).toContain("allowlists.selectable on the User config");
  });

  it("names the same key for a programmatic filter expression", () => {
    const detail = issuesOf(() =>
      normalizer.normalizeInput(
        { filter: { kind: "condition", field: "emial", operator: "EQ", value: "a" } } as never,
        config,
      ),
    )[0]!.detail;
    expect(detail).toContain("Did you mean 'email'?");
    expect(detail).toContain("allowlists.filterable on the User config");
  });

  it("says the same thing through the programmatic entry point", () => {
    // The two entry points share one gate, so the security posture and the
    // message quality cannot diverge between them.
    const wire = issuesOf(() => normalizer.normalizeWire({ sort: "emial" }, config))[0]!.detail;
    const programmatic = issuesOf(() =>
      normalizer.normalizeInput({ sort: [{ field: "emial", direction: "asc" }] } as never, config),
    )[0]!.detail;
    expect(programmatic).toBe(wire);
  });

  it("offers no suggestion when nothing is close, and still names the fix", () => {
    const detail = issuesOf(() => normalizer.normalizeWire({ sort: "passwordHash" }, config))[0]!.detail;
    expect(detail).not.toContain("Did you mean");
    expect(detail).toContain("allowlists.sortable");
  });

  it("collects every rejection into one round trip", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ sort: "emial", fields: "nmae" }, config));
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.detail.includes("Did you mean"))).toBe(true);
  });
});
