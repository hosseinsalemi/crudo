import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newTestPrismaClient, provisionTestDatabase } from "./support/client.js";
import { SCRATCH_ROOT_ENV } from "./support/global-setup.js";

/**
 * The fixture-provisioning contract itself. Every other spec file in this
 * package opens a `beforeEach` with a chain of `deleteMany()` writes, and
 * vitest runs those files in parallel workers; SQLite admits one writer at a
 * time, so a single shared file made the suite fail with `P1008` under CI load
 * (issue #101). These tests pin the property that removed the contention:
 * one database file per client, never a shared one.
 */
describe("test-fixture database provisioning", () => {
  it("gives every client a database of its own", async () => {
    const first = newTestPrismaClient();
    const second = newTestPrismaClient();
    try {
      await first.invoice.create({ data: { number: "INV-101" } });

      expect(await first.invoice.count()).toBe(1);
      expect(await second.invoice.count()).toBe(0);
    } finally {
      await first.$disconnect();
      await second.$disconnect();
    }
  });

  it("copies the template to a fresh path on every call", () => {
    const first = provisionTestDatabase();
    const second = provisionTestDatabase();

    expect(first).not.toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
  });

  it("fails with a fixable message when the template has not been generated", () => {
    const missing = join(tmpdir(), "kavo-prisma-no-such-template.db");

    expect(() => provisionTestDatabase(missing)).toThrow(/pnpm generate/);
  });

  it("refuses to provision outside the run's scratch root", () => {
    // Falling back to the OS temp directory here would work, and leak a
    // fixture database per client forever — nothing else deletes those.
    const scratchRoot = process.env[SCRATCH_ROOT_ENV];
    delete process.env[SCRATCH_ROOT_ENV];
    try {
      expect(() => provisionTestDatabase()).toThrow(new RegExp(SCRATCH_ROOT_ENV));
    } finally {
      if (scratchRoot !== undefined) process.env[SCRATCH_ROOT_ENV] = scratchRoot;
    }
  });
});
