import { describe, expect, it } from "vitest";
import type { PaginationLimits } from "@kavo/core";
import { OffsetPaginationStrategy, PagePaginationStrategy, builtInPaginationStrategies } from "@kavo/core";
import { issuesOf } from "./support/query-issues.js";

const limits: PaginationLimits = { defaultLimit: 20, maxLimit: 100 };
const offset = new OffsetPaginationStrategy();
const page = new PagePaginationStrategy();

describe("OffsetPaginationStrategy — flat limit/offset (Phase 5)", () => {
  it("falls back to defaultLimit and offset 0 when nothing is sent", () => {
    expect(offset.normalize({}, limits)).toEqual({ limit: 20, offset: 0 });
  });

  it("passes an in-range limit and offset through unchanged", () => {
    expect(offset.normalize({ limit: "20", offset: "40" }, limits)).toEqual({ limit: 20, offset: 40 });
  });

  it("clamps a limit above maxLimit instead of rejecting it", () => {
    // The grammar deliberately splits the two failure modes: over-asking is
    // served smaller, malformed input is a 400.
    expect(offset.normalize({ limit: "9999" }, limits)).toEqual({ limit: 100, offset: 0 });
  });

  it("accepts numbers as well as wire strings", () => {
    expect(offset.normalize({ limit: 5, offset: 10 }, limits)).toEqual({ limit: 5, offset: 10 });
  });

  it("treats empty string, null, and undefined as absent, not malformed", () => {
    for (const absent of ["", null, undefined]) {
      expect(offset.normalize({ limit: absent, offset: absent }, limits)).toEqual({ limit: 20, offset: 0 });
    }
  });

  it("rejects a non-numeric limit as a field-level query issue", () => {
    const issues = issuesOf(() => offset.normalize({ limit: "abc" }, limits));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "limit", code: "KAVO_QUERY_INVALID_VALUE" });
  });

  it("names the offending param, so a bad offset does not report as 'limit'", () => {
    const issues = issuesOf(() => offset.normalize({ offset: "abc" }, limits));
    expect(issues[0]).toMatchObject({ field: "offset", code: "KAVO_QUERY_INVALID_VALUE" });
  });

  it("rejects fractional values on either param", () => {
    expect(issuesOf(() => offset.normalize({ limit: "1.5" }, limits))[0]?.field).toBe("limit");
    expect(issuesOf(() => offset.normalize({ offset: "0.5" }, limits))[0]?.field).toBe("offset");
  });

  it("enforces limit >= 1 and offset >= 0", () => {
    expect(issuesOf(() => offset.normalize({ limit: "0" }, limits))[0]?.field).toBe("limit");
    expect(issuesOf(() => offset.normalize({ limit: "-1" }, limits))[0]?.field).toBe("limit");
    expect(issuesOf(() => offset.normalize({ offset: "-1" }, limits))[0]?.field).toBe("offset");
    // The zero the two minimums disagree about: legal for offset only.
    expect(offset.normalize({ offset: "0" }, limits).offset).toBe(0);
  });

  it("raises one aggregate KAVO_QUERY_INVALID carrying the sub-coded issue", () => {
    try {
      offset.normalize({ limit: "abc" }, limits);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "KAVO_QUERY_INVALID",
        status: 400,
        issues: [{ code: "KAVO_QUERY_INVALID_VALUE" }],
      });
    }
  });
});

describe("PagePaginationStrategy — page[number]/page[size] (Phase 5)", () => {
  it("normalizes 1-indexed pages to the internal limit/offset form", () => {
    expect(page.normalize({ "page[number]": "3", "page[size]": "10" }, limits)).toEqual({ limit: 10, offset: 20 });
  });

  it("starts page 1 at offset 0", () => {
    expect(page.normalize({ "page[number]": "1", "page[size]": "10" }, limits)).toEqual({ limit: 10, offset: 0 });
  });

  it("falls back to defaultLimit and page 1 when nothing is sent", () => {
    expect(page.normalize({}, limits)).toEqual({ limit: 20, offset: 0 });
  });

  it("defaults the page number when only a size is sent, and vice versa", () => {
    expect(page.normalize({ "page[size]": "5" }, limits)).toEqual({ limit: 5, offset: 0 });
    expect(page.normalize({ "page[number]": "3" }, limits)).toEqual({ limit: 20, offset: 40 });
  });

  it("clamps page[size] to maxLimit before computing the offset", () => {
    // Ordering is load-bearing: the offset must be a multiple of the page
    // size actually served, or page 3 would skip rows page 2 never showed.
    expect(page.normalize({ "page[number]": "3", "page[size]": "9999" }, limits)).toEqual({ limit: 100, offset: 200 });
  });

  it("rejects page[number] below 1 — pages are 1-indexed", () => {
    expect(issuesOf(() => page.normalize({ "page[number]": "0" }, limits))[0]).toMatchObject({
      field: "page[number]",
      code: "KAVO_QUERY_INVALID_VALUE",
    });
  });

  it("rejects malformed or non-positive page[size]", () => {
    for (const size of ["abc", "0", "-2", "2.5"]) {
      expect(issuesOf(() => page.normalize({ "page[size]": size }, limits))[0]).toMatchObject({
        field: "page[size]",
        code: "KAVO_QUERY_INVALID_VALUE",
      });
    }
  });

  it("treats empty string, null, and undefined as absent, not malformed", () => {
    for (const absent of ["", null, undefined]) {
      expect(page.normalize({ "page[number]": absent, "page[size]": absent }, limits)).toEqual({
        limit: 20,
        offset: 0,
      });
    }
  });
});

describe("builtInPaginationStrategies (Phase 5)", () => {
  it("ships exactly the two built-ins, keyed by strategy name", () => {
    const strategies = builtInPaginationStrategies();
    expect([...strategies.keys()].sort()).toEqual(["offset", "page"]);
  });

  it("keys each strategy by its own name property", () => {
    for (const [name, strategy] of builtInPaginationStrategies()) {
      expect(strategy.name).toBe(name);
    }
  });

  it("maps the names to the two exported classes", () => {
    const strategies = builtInPaginationStrategies();
    expect(strategies.get("offset")).toBeInstanceOf(OffsetPaginationStrategy);
    expect(strategies.get("page")).toBeInstanceOf(PagePaginationStrategy);
  });
});
