import { describe, expect, it } from "vitest";
import { QueryNormalizer, resolveEntityConfig } from "@kavo/core";
import { userMetadata } from "./support/user-fixture.js";
import { issuesOf } from "./support/query-issues.js";

const config = resolveEntityConfig(userMetadata, undefined, undefined);
const normalizer = new QueryNormalizer(userMetadata);

describe("QueryNormalizer — wire params (Phase 5 pipeline)", () => {
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
