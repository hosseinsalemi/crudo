import { describe, expect, it } from "vitest";
import type { KavoSettings, DeepPartial } from "@kavo/core";
import { BUILT_IN_DEFAULTS, ConfigurationException, mergeSettings, validateSettings } from "@kavo/core";

/**
 * Validate one override merged onto the built-in defaults, returning the
 * `ConfigurationException` it must raise. The final throw is what stops a
 * test from passing vacuously when validation accepts the value
 * (cf. tests/support/query-issues.ts).
 */
function rejectionOf(override: unknown): ConfigurationException {
  try {
    validateSettings("User", mergeSettings(BUILT_IN_DEFAULTS, override as DeepPartial<KavoSettings>));
  } catch (error) {
    if (error instanceof ConfigurationException) return error;
    throw error;
  }
  throw new Error("expected ConfigurationException");
}

/** The error bar: every config error names entity, key path, and offending value. */
function expectRejected(override: unknown, path: string, offending: unknown): void {
  const error = rejectionOf(override);
  expect(error.code).toBe("KAVO_CONFIG_INVALID");
  expect(error.messageParams).toMatchObject({ entity: "User", path });
  expect(String(error.messageParams["problem"])).toContain(JSON.stringify(offending));
}

function accept(override: unknown): void {
  validateSettings("User", mergeSettings(BUILT_IN_DEFAULTS, override as DeepPartial<KavoSettings>));
}

/** Values no positive-integer setting may take. */
const NOT_POSITIVE_INTEGERS = [0, -1, 1.5, "20", null, true];

describe("validateSettings — pagination", () => {
  it("rejects a defaultLimit that is not a positive integer", () => {
    for (const value of NOT_POSITIVE_INTEGERS) {
      expectRejected({ pagination: { defaultLimit: value } }, "pagination.defaultLimit", value);
    }
  });

  it("rejects a non-boolean count", () => {
    for (const value of ["true", 1, null]) {
      expectRejected({ pagination: { count: value } }, "pagination.count", value);
    }
  });

  it("rejects a strategy that is not a name", () => {
    for (const value of [1, null, false]) {
      expectRejected({ pagination: { strategy: value } }, "pagination.strategy", value);
    }
  });

  it("accepts a defaultLimit exactly at maxLimit", () => {
    expect(() => accept({ pagination: { defaultLimit: 100, maxLimit: 100 } })).not.toThrow();
  });

  it("accepts the smallest legal limits", () => {
    expect(() => accept({ pagination: { defaultLimit: 1, maxLimit: 1 } })).not.toThrow();
  });

  it("accepts an unrecognized strategy name — resolving it is the normalizer's job", () => {
    // A custom strategy is registered on the root factory
    // (`paginationStrategies`), which this function cannot see; an unknown
    // name surfaces at query time instead.
    expect(() => accept({ pagination: { strategy: "cursor" } })).not.toThrow();
  });
});

describe("validateSettings — query limits", () => {
  it("rejects a maxFilterDepth that is not a positive integer", () => {
    for (const value of NOT_POSITIVE_INTEGERS) {
      expectRejected({ query: { maxFilterDepth: value } }, "query.maxFilterDepth", value);
    }
  });

  it("rejects a maxInValues that is not a positive integer", () => {
    for (const value of NOT_POSITIVE_INTEGERS) {
      expectRejected({ query: { maxInValues: value } }, "query.maxInValues", value);
    }
  });

  it("accepts a depth and a value cap of 1", () => {
    expect(() => accept({ query: { maxFilterDepth: 1, maxInValues: 1 } })).not.toThrow();
  });
});

describe("validateSettings — errors", () => {
  it("rejects a non-boolean exposeInternals", () => {
    for (const value of ["false", 0, null]) {
      expectRejected({ errors: { exposeInternals: value } }, "errors.exposeInternals", value);
    }
  });

  it("accepts both booleans", () => {
    expect(() => accept({ errors: { exposeInternals: true } })).not.toThrow();
    expect(() => accept({ errors: { exposeInternals: false } })).not.toThrow();
  });
});

describe("validateSettings — relation limits", () => {
  it("rejects a maxIncludeDepth that is not a positive integer", () => {
    for (const value of NOT_POSITIVE_INTEGERS) {
      expectRejected({ relations: { maxIncludeDepth: value } }, "relations.maxIncludeDepth", value);
    }
  });

  it("rejects a maxIncludedNodes that is not a positive integer", () => {
    for (const value of NOT_POSITIVE_INTEGERS) {
      expectRejected({ relations: { maxIncludedNodes: value } }, "relations.maxIncludedNodes", value);
    }
  });

  it("accepts a budget of one node at depth one", () => {
    expect(() => accept({ relations: { maxIncludeDepth: 1, maxIncludedNodes: 1 } })).not.toThrow();
  });
});

describe("validateSettings — relation edges", () => {
  it("rejects an edge that is not an object, naming the relation", () => {
    for (const value of [true, 5, "posts", null]) {
      expectRejected({ relations: { edges: { posts: value } } }, "relations.edges.posts", value);
    }
  });

  it("rejects a non-boolean includable", () => {
    expectRejected(
      { relations: { edges: { posts: { includable: "yes" } } } },
      "relations.edges.posts.includable",
      "yes",
    );
  });

  it("rejects a non-boolean defaultInclude", () => {
    expectRejected(
      { relations: { edges: { posts: { defaultInclude: 1 } } } },
      "relations.edges.posts.defaultInclude",
      1,
    );
  });

  it("rejects a maxDepth that is not a positive integer", () => {
    for (const value of NOT_POSITIVE_INTEGERS) {
      expectRejected({ relations: { edges: { posts: { maxDepth: value } } } }, "relations.edges.posts.maxDepth", value);
    }
  });

  it("rejects a load strategy outside join, batch, and auto", () => {
    for (const value of ["eager", "JOIN", 1]) {
      expectRejected({ relations: { edges: { posts: { strategy: value } } } }, "relations.edges.posts.strategy", value);
    }
  });

  it("rejects defaultInclude on a relation clients cannot ask for", () => {
    // The offending value here is the edge as a whole: neither key is
    // wrong alone, the pair is.
    const error = rejectionOf({
      relations: { edges: { posts: { includable: false, defaultInclude: true } } },
    });
    expect(error.code).toBe("KAVO_CONFIG_INVALID");
    expect(error.messageParams).toMatchObject({ entity: "User", path: "relations.edges.posts" });
  });

  it("accepts an edge that configures nothing — every sub-key is optional", () => {
    expect(() => accept({ relations: { edges: { posts: {} } } })).not.toThrow();
  });

  it("accepts each documented load strategy", () => {
    for (const strategy of ["join", "batch", "auto"]) {
      expect(() => accept({ relations: { edges: { posts: { strategy } } } })).not.toThrow();
    }
  });

  it("accepts defaultInclude on an includable relation", () => {
    expect(() =>
      accept({ relations: { edges: { posts: { includable: true, defaultInclude: true, maxDepth: 1 } } } }),
    ).not.toThrow();
  });
});

describe("validateSettings — soft delete", () => {
  it("rejects a softDelete that names no delete-marker field", () => {
    for (const softDelete of [true, 1, "deletedAt", { field: "" }, { field: 5 }]) {
      const error = rejectionOf({ softDelete });
      expect(error.messageParams).toMatchObject({ entity: "User", path: "softDelete" });
    }
    expect(String(rejectionOf({ softDelete: true }).messageParams["problem"])).toContain("true");
  });

  it("rejects a strategy outside auto, soft, and hard", () => {
    for (const value of ["off", "SOFT", 1, null]) {
      expectRejected({ softDelete: { strategy: value } }, "softDelete.strategy", value);
    }
  });

  it("accepts `false` — the documented way to disable the feature entirely", () => {
    expect(() => accept({ softDelete: false })).not.toThrow();
  });

  it("accepts each documented strategy on a named field", () => {
    for (const strategy of ["auto", "soft", "hard"]) {
      expect(() => accept({ softDelete: { field: "removedAt", strategy } })).not.toThrow();
    }
  });
});

describe("validateSettings — global operations default (issue #38)", () => {
  it("rejects an unknown operation id", () => {
    const error = rejectionOf({ operations: { notAnOperation: false } });
    expect(error.code).toBe("KAVO_CONFIG_INVALID");
    expect(error.messageParams).toMatchObject({ entity: "User", path: "operations.notAnOperation" });
  });

  it("rejects a non-boolean value for a known operation id", () => {
    for (const value of ["off", 1, null]) {
      expectRejected({ operations: { deleteOne: value } }, "operations.deleteOne", value);
    }
  });

  it("accepts a boolean map over known operation ids", () => {
    expect(() => accept({ operations: { deleteOne: false, patchOne: false, restoreOne: true } })).not.toThrow();
  });

  it("accepts an empty map — the zero-config default", () => {
    expect(() => accept({ operations: {} })).not.toThrow();
  });
});

describe("validateSettings — the base of the precedence chain", () => {
  it("accepts the built-in defaults unchanged", () => {
    // Everything merges onto these, so a schema change that leaves them
    // invalid would break the zero-config path first.
    expect(() => validateSettings("User", BUILT_IN_DEFAULTS)).not.toThrow();
  });

  it("names whichever scope label the caller passed", () => {
    // The engine validates per-call overrides under a derived label, so
    // the entity name is a parameter, not a lookup.
    try {
      validateSettings("User (per-call)", mergeSettings(BUILT_IN_DEFAULTS, { query: { maxInValues: 0 } }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigurationException).messageParams).toMatchObject({
        entity: "User (per-call)",
        path: "query.maxInValues",
      });
    }
  });
});
