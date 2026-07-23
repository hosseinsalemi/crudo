import { describe, expect, it } from "vitest";
import { QueryNormalizer, QueryValidationException, resolveEntityConfig } from "@crudo/core";
import { userMetadata } from "./support/user-fixture.js";

const config = resolveEntityConfig(userMetadata, undefined, undefined);
const normalizer = new QueryNormalizer(userMetadata);

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof QueryValidationException) return error.issues;
    throw error;
  }
  throw new Error("expected QueryValidationException");
}

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
      code: "CRUDO_QUERY_INVALID_VALUE",
    });
  });

  it("rejects non-sortable fields", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ sort: "-password" }, config));
    expect(issues[0]).toMatchObject({
      field: "password",
      code: "CRUDO_QUERY_INVALID_FIELD",
    });
  });

  it("rejects include and withDeleted=true explicitly (deferred features)", () => {
    const issues = issuesOf(() => normalizer.normalizeWire({ include: "posts", withDeleted: "true" }, config));
    const codes = issues.map((issue) => issue.code);
    expect(codes).toEqual(["CRUDO_QUERY_UNSUPPORTED_PARAM", "CRUDO_QUERY_UNSUPPORTED_PARAM"]);
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
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_FIELD");
  });
});
