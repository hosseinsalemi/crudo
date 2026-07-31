import { describe, expect, it } from "vitest";
import type { Filter } from "@kavo/core";
import { translateFilter } from "@kavo/prisma";

function ilikeFilter(value: string): Filter {
  return { root: { kind: "condition", field: "name", operator: "ILIKE", value } };
}

describe("translateFilter — caseInsensitiveFilters", () => {
  it("adds Prisma's mode: 'insensitive' for ILIKE when the connector supports it (default)", () => {
    const where = translateFilter(ilikeFilter("a%"), { caseInsensitiveFilters: true });
    expect(where).toEqual({ name: { startsWith: "a", mode: "insensitive" } });
  });

  it("omits mode entirely when the connector doesn't support it (e.g. SQLite)", () => {
    const where = translateFilter(ilikeFilter("a%"), { caseInsensitiveFilters: false });
    expect(where).toEqual({ name: { startsWith: "a" } });
  });

  it("leaves plain LIKE untouched by the setting either way", () => {
    const filter: Filter = { root: { kind: "condition", field: "name", operator: "LIKE", value: "a%" } };
    expect(translateFilter(filter, { caseInsensitiveFilters: true })).toEqual({ name: { startsWith: "a" } });
    expect(translateFilter(filter, { caseInsensitiveFilters: false })).toEqual({ name: { startsWith: "a" } });
  });
});
