import { describe, expect, it } from "vitest";
import type { FilterCondition, FilterGroup } from "@crudo/core";
import {
  DefaultFilterParser,
  QueryValidationException,
  resolveEntityConfig,
} from "@crudo/core";
import { userMetadata } from "./support/user-fixture.js";

const config = resolveEntityConfig(userMetadata, undefined, undefined);
const parser = new DefaultFilterParser(userMetadata);

function parse(params: Record<string, unknown>) {
  return parser.parse(params, config);
}

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof QueryValidationException) return error.issues;
    throw error;
  }
  throw new Error("expected QueryValidationException");
}

describe("DefaultFilterParser — bracket grammar (Phase 5)", () => {
  it("parses a single comparison with coercion", () => {
    const filter = parse({ "filter[age][gte]": "18" });
    expect(filter.root).toEqual({
      kind: "condition",
      field: "age",
      operator: "GTE",
      value: 18,
    });
  });

  it("ANDs multiple filter params implicitly", () => {
    const filter = parse({
      "filter[age][gte]": "18",
      "filter[status][eq]": "active",
    });
    const root = filter.root as FilterGroup;
    expect(root.operator).toBe("AND");
    expect(root.children).toHaveLength(2);
  });

  it("parses the spec's reference example (or-group, in, like)", () => {
    const filter = parse({
      "filter[age][gte]": "18",
      "filter[status][in]": "active,pending",
      "filter[name][like]": "%john%",
      "filter[or][0][name][eq]": "admin",
      "filter[or][1][status][eq]": "banned",
    });
    const root = filter.root as FilterGroup;
    expect(root.operator).toBe("AND");
    const or = root.children.find(
      (child): child is FilterGroup =>
        child.kind === "group" && child.operator === "OR",
    );
    expect(or?.children).toHaveLength(2);
    const inCondition = root.children.find(
      (child): child is FilterCondition =>
        child.kind === "condition" && child.operator === "IN",
    );
    expect(inCondition?.value).toEqual(["active", "pending"]);
  });

  it("accepts the repeated-key form for IN", () => {
    const filter = parse({ "filter[status][in][]": ["active", "pending"] });
    expect(filter.root).toMatchObject({
      operator: "IN",
      value: ["active", "pending"],
    });
  });

  it("builds NOT groups with a single child", () => {
    const filter = parse({ "filter[not][status][eq]": "banned" });
    const root = filter.root as FilterGroup;
    expect(root.operator).toBe("NOT");
    expect(root.children).toHaveLength(1);
  });

  it("coerces dates and booleans; flips isNull=false", () => {
    const date = parse({ "filter[createdAt][gte]": "2026-01-01" })
      .root as FilterCondition;
    expect(date.value).toBeInstanceOf(Date);

    const flipped = parse({ "filter[name][isNull]": "false" })
      .root as FilterCondition;
    expect(flipped.operator).toBe("IS_NOT_NULL");
  });

  it("parses BETWEEN with exactly two bounds", () => {
    const filter = parse({ "filter[age][between]": "18,65" })
      .root as FilterCondition;
    expect(filter.value).toEqual([18, 65]);
    const issues = issuesOf(() => parse({ "filter[age][between]": "1,2,3" }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_VALUE");
  });
});

describe("DefaultFilterParser — JSON escape hatch", () => {
  it("produces the identical AST as bracket notation", () => {
    const bracket = parse({
      "filter[or][0][name][eq]": "admin",
      "filter[or][1][status][eq]": "banned",
    });
    const json = parse({
      filter: JSON.stringify({
        or: [{ name: { eq: "admin" } }, { status: { eq: "banned" } }],
      }),
    });
    expect(json).toEqual(bracket);
  });

  it("rejects malformed JSON explicitly", () => {
    const issues = issuesOf(() => parse({ filter: "{nope" }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_VALUE");
  });
});

describe("DefaultFilterParser — security posture", () => {
  it("rejects non-allowlisted fields with a 400, never silently drops", () => {
    const issues = issuesOf(() => parse({ "filter[password][eq]": "x" }));
    expect(issues[0]).toMatchObject({
      field: "password",
      code: "CRUDO_QUERY_INVALID_FIELD",
    });
  });

  it("rejects unknown operators (exact-case, no aliases)", () => {
    const issues = issuesOf(() => parse({ "filter[age][GTE]": "18" }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_OPERATOR");
  });

  it("rejects coercion failures as field-level issues", () => {
    const issues = issuesOf(() => parse({ "filter[age][eq]": "abc" }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_VALUE");
    expect(issues[0]?.detail).toContain("abc");
  });

  it("rejects enum values outside the member list", () => {
    const issues = issuesOf(() => parse({ "filter[status][eq]": "vip" }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_VALUE");
  });

  it("enforces maxInValues", () => {
    const many = Array.from({ length: 101 }, (_, i) => String(i)).join(",");
    const issues = issuesOf(() => parse({ "filter[age][in]": many }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_LIMIT_EXCEEDED");
  });

  it("enforces maxFilterDepth", () => {
    const issues = issuesOf(() =>
      parse({
        filter: JSON.stringify({
          or: [{ and: [{ or: [{ not: { name: { eq: "x" } } }] }] }],
        }),
      }),
    );
    expect(issues.some((i) => i.code === "CRUDO_QUERY_LIMIT_EXCEEDED")).toBe(true);
  });

  it("collects every issue into one exception", () => {
    const issues = issuesOf(() =>
      parse({
        "filter[password][eq]": "x",
        "filter[age][eq]": "abc",
      }),
    );
    expect(issues).toHaveLength(2);
  });

  it("restricts LIKE to string columns", () => {
    const issues = issuesOf(() => parse({ "filter[age][like]": "%1%" }));
    expect(issues[0]?.code).toBe("CRUDO_QUERY_INVALID_VALUE");
  });
});
