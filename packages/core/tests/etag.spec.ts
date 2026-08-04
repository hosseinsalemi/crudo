import { describe, expect, it } from "vitest";
import { canonicalize, computeEtag, strongMatch, weakMatch } from "../src/caching/etag.js";

/**
 * The hash primitive on its own. The engine-level behavior it feeds
 * (which responses carry a tag, which requests are refused) lives in
 * `caching.spec.ts`; this file pins the properties that file relies on.
 */
describe("canonicalize", () => {
  it("is insensitive to object key order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalize({ outer: { a: 1, b: 2 } })).toBe(canonicalize({ outer: { b: 2, a: 1 } }));
  });

  it("keeps array order significant", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("distinguishes a missing key from a null one", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 1, b: null }));
  });

  it("drops undefined members the way JSON encoding does", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("renders dates as their ISO string", () => {
    expect(canonicalize(new Date("2020-01-01T00:00:00.000Z"))).toBe('"2020-01-01T00:00:00.000Z"');
  });

  it("renders non-finite numbers as null, like JSON.stringify", () => {
    expect(canonicalize({ a: Number.NaN })).toBe(canonicalize({ a: null }));
  });
});

describe("computeEtag", () => {
  it("produces a quoted strong entity-tag", async () => {
    const etag = await computeEtag({ id: 1 });
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("is stable for the same representation", async () => {
    expect(await computeEtag({ id: 1, name: "Ada" })).toBe(await computeEtag({ id: 1, name: "Ada" }));
  });

  it("ignores key order, so a DTO field reorder is not a cache miss", async () => {
    expect(await computeEtag({ id: 1, name: "Ada" })).toBe(await computeEtag({ name: "Ada", id: 1 }));
  });

  it("changes when any value changes", async () => {
    expect(await computeEtag({ id: 1, name: "Ada" })).not.toBe(await computeEtag({ id: 1, name: "Grace" }));
  });
});

describe("entity-tag comparison (RFC 9110 §8.8.3)", () => {
  it("strong comparison matches an identical strong tag", () => {
    expect(strongMatch(['"a"'], '"a"')).toBe(true);
  });

  it("strong comparison never matches a weak candidate", () => {
    expect(strongMatch(['W/"a"'], '"a"')).toBe(false);
  });

  it("strong comparison accepts the wildcard", () => {
    expect(strongMatch(["*"], '"a"')).toBe(true);
  });

  it("strong comparison scans every candidate in the list", () => {
    expect(strongMatch(['"x"', '"a"'], '"a"')).toBe(true);
    expect(strongMatch(['"x"', '"y"'], '"a"')).toBe(false);
  });

  it("weak comparison ignores the W/ prefix on either side", () => {
    expect(weakMatch(['W/"a"'], '"a"')).toBe(true);
    expect(weakMatch(['"a"'], 'W/"a"')).toBe(true);
  });

  it("weak comparison accepts the wildcard and rejects a different tag", () => {
    expect(weakMatch(["*"], '"a"')).toBe(true);
    expect(weakMatch(['"b"'], '"a"')).toBe(false);
  });

  it("an empty candidate list never matches", () => {
    expect(strongMatch([], '"a"')).toBe(false);
    expect(weakMatch([], '"a"')).toBe(false);
  });
});
