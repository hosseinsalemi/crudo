import { describe, expect, it } from "vitest";
import { BUILT_IN_DEFAULTS, ConfigurationException, mergeSettings, resolveEntityConfig } from "@kavo/core";
import { User, userMetadata } from "./support/user-fixture.js";

describe("mergeSettings — merge algebra", () => {
  it("replaces scalars key-by-key, nearer scope wins", () => {
    const merged = mergeSettings(
      BUILT_IN_DEFAULTS,
      { pagination: { defaultLimit: 10 } },
      { pagination: { maxLimit: 50 } },
    );
    expect(merged.pagination.defaultLimit).toBe(10);
    expect(merged.pagination.maxLimit).toBe(50);
    // Untouched keys keep the farther scope's values.
    expect(merged.pagination.strategy).toBe("offset");
    expect(merged.query.maxFilterDepth).toBe(3);
  });

  it("lets `false` disable an inheritable feature", () => {
    const merged = mergeSettings(BUILT_IN_DEFAULTS, { softDelete: false });
    expect(merged.softDelete).toBe(false);
    // …and a nearer object re-enables it.
    const reEnabled = mergeSettings(merged, { softDelete: { field: "removedAt" } });
    expect(reEnabled.softDelete).toEqual({ field: "removedAt" });
  });

  it("skips undefined scopes", () => {
    const merged = mergeSettings(BUILT_IN_DEFAULTS, undefined, {
      errors: { exposeInternals: true },
    });
    expect(merged.errors.exposeInternals).toBe(true);
  });
});

describe("resolveEntityConfig — bootstrap", () => {
  it("resolves the zero-config path on built-in defaults", () => {
    const config = resolveEntityConfig(userMetadata, undefined, undefined);
    expect(config.entityName).toBe("User");
    expect(config.settings.pagination.defaultLimit).toBe(20);
    // Allowlists derive from own scalar columns.
    expect(config.allowlists.filterable).toEqual(["id", "name", "email", "age", "status", "createdAt"]);
  });

  it("applies the precedence chain global → entity → operation", () => {
    const config = resolveEntityConfig(
      userMetadata,
      {
        pagination: { defaultLimit: 5 },
        operations: { findMany: { pagination: { defaultLimit: 3 } } },
      },
      { pagination: { defaultLimit: 10, maxLimit: 50 } },
    );
    expect(config.settings.pagination.defaultLimit).toBe(5); // entity beats global
    expect(config.settings.pagination.maxLimit).toBe(50); // global beats built-in
    expect(config.settingsFor("findMany").pagination.defaultLimit).toBe(3);
    expect(config.settingsFor("findOne").pagination.defaultLimit).toBe(5);
  });

  it("freezes the resolved settings", () => {
    const config = resolveEntityConfig(userMetadata, undefined, undefined);
    expect(Object.isFrozen(config.settings)).toBe(true);
    expect(Object.isFrozen(config.settings.pagination)).toBe(true);
  });

  it("fails fast naming entity, key path, and offending value", () => {
    expect(() => resolveEntityConfig(userMetadata, { pagination: { maxLimit: -1 } }, undefined)).toThrowError(
      ConfigurationException,
    );
    try {
      resolveEntityConfig(userMetadata, { pagination: { maxLimit: -1 } }, undefined);
    } catch (error) {
      const detail = (error as ConfigurationException).detail;
      expect(detail).toContain("User");
      expect(detail).toContain("pagination.maxLimit");
      expect(detail).toContain("-1");
    }
  });

  it("rejects defaultLimit above maxLimit", () => {
    expect(() => resolveEntityConfig(userMetadata, { pagination: { defaultLimit: 200 } }, undefined)).toThrowError(
      /exceeds maxLimit/,
    );
  });

  it("uses explicit allowlists verbatim when configured", () => {
    const config = resolveEntityConfig(userMetadata, { allowlists: { filterable: ["name", "age"] } }, undefined);
    expect(config.allowlists.filterable).toEqual(["name", "age"]);
    // Unconfigured lists still derive.
    expect(config.allowlists.sortable).toContain("email");
  });

  it("resolves { exclude } to every own column except the ones named", () => {
    const config = resolveEntityConfig(userMetadata, { allowlists: { filterable: { exclude: ["email"] } } }, undefined);
    expect(config.allowlists.filterable).toEqual(["id", "name", "age", "status", "createdAt"]);
    // Unconfigured lists still derive in full.
    expect(config.allowlists.sortable).toContain("email");
  });

  it("never lets { exclude } surface a column outside own columns", () => {
    // A name that isn't an own column is a no-op to exclude — the result
    // stays a subset of own columns, never an arbitrary string added in.
    const notAColumn = "notAColumn" as unknown as keyof User;
    const config = resolveEntityConfig(
      userMetadata,
      { allowlists: { filterable: { exclude: [notAColumn] } } },
      undefined,
    );
    expect(config.allowlists.filterable).toEqual(["id", "name", "email", "age", "status", "createdAt"]);
  });

  it("resolves { exclude } independently for sortable and selectable too", () => {
    const config = resolveEntityConfig(
      userMetadata,
      {
        allowlists: {
          sortable: { exclude: ["status"] },
          selectable: { exclude: ["age", "status"] },
        },
      },
      undefined,
    );
    expect(config.allowlists.sortable).toEqual(["id", "name", "email", "age", "createdAt"]);
    expect(config.allowlists.selectable).toEqual(["id", "name", "email", "createdAt"]);
    // Unconfigured filterable still derives in full.
    expect(config.allowlists.filterable).toContain("status");
  });

  it("resolves an entity-scope defaultSort", () => {
    const config = resolveEntityConfig(
      userMetadata,
      { query: { defaultSort: [{ field: "createdAt", direction: "desc" }] } },
      undefined,
    );
    expect(config.settings.query.defaultSort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  it("lets an operation override the entity-scope defaultSort", () => {
    const config = resolveEntityConfig(
      userMetadata,
      {
        query: { defaultSort: [{ field: "createdAt", direction: "desc" }] },
        operations: { findMany: { query: { defaultSort: [{ field: "name", direction: "asc" }] } } },
      },
      undefined,
    );
    expect(config.settingsFor("findMany").query.defaultSort).toEqual([{ field: "name", direction: "asc" }]);
    expect(config.settingsFor("findOne").query.defaultSort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  it("applies the precedence chain global -> entity for defaultSort", () => {
    const config = resolveEntityConfig(
      userMetadata,
      { query: { defaultSort: [{ field: "name", direction: "asc" }] } },
      { query: { defaultSort: [{ field: "createdAt", direction: "desc" }] } },
    );
    expect(config.settings.query.defaultSort).toEqual([{ field: "name", direction: "asc" }]); // entity beats global

    const globalOnly = resolveEntityConfig(userMetadata, undefined, {
      query: { defaultSort: [{ field: "createdAt", direction: "desc" }] },
    });
    expect(globalOnly.settings.query.defaultSort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  it("rejects an entity-scope defaultSort field outside the sortable allowlist", () => {
    try {
      resolveEntityConfig(
        userMetadata,
        {
          allowlists: { sortable: ["name"] },
          query: { defaultSort: [{ field: "email", direction: "asc" }] },
        },
        undefined,
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigurationException).code).toBe("KAVO_CONFIG_INVALID");
      expect((error as ConfigurationException).detail).toContain("email");
    }
  });

  it("rejects an operation-scope defaultSort field outside the sortable allowlist", () => {
    try {
      resolveEntityConfig(
        userMetadata,
        {
          allowlists: { sortable: ["name"] },
          operations: { findMany: { query: { defaultSort: [{ field: "email", direction: "asc" }] } } },
        },
        undefined,
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigurationException).code).toBe("KAVO_CONFIG_INVALID");
      expect((error as ConfigurationException).detail).toContain("email");
    }
  });
});

describe("User fixture sanity", () => {
  it("has runtime shape (initialized fields)", () => {
    expect(Object.keys(new User())).toContain("email");
  });
});
