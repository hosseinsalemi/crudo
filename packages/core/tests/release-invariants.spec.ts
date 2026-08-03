import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The rules that decide what a release publishes, asserted at `pnpm check`
 * time instead of tag time.
 *
 * `.github/workflows/publish.yml` enforces all of this before it publishes,
 * but only once a `v*.*.*` tag has been pushed — and a tag is the one thing
 * in this pipeline that cannot be taken back, because npm forbids
 * republishing a version. Every invariant below has already been broken in
 * this repo at least once: `@kavo/prisma` sat at `0.5.0` while everything
 * else moved to `0.6.0`, and `@kavo/nest` was ordered ahead of the two
 * packages it hard-depends on. Both were invisible until release.
 *
 * Nothing here is a second source of truth. `PACKAGE_DIRS` in the workflow
 * stays authoritative for membership and order and is parsed out of the
 * workflow itself; the workspace side is derived from `pnpm-workspace.yaml`
 * and each package's own `private` flag. Adding a package still means
 * editing exactly one list.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

const readJson = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`${dir}/package.json`, REPO_ROOT), "utf8")) as Record<string, unknown>;

const nameOf = (dir: string): string => readJson(dir).name as string;

const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

/**
 * `PACKAGE_DIRS` is a YAML `>-` folded block, so it has to be read by
 * indentation: a `/PACKAGE_DIRS:\s*>-\n((?:\s+\S+\n)+)/` regex keeps
 * matching past the block and swallows the following `steps:` key.
 */
function readPackageDirs(): string[] {
  const lines = readFileSync(new URL(".github/workflows/publish.yml", REPO_ROOT), "utf8").split("\n");
  const start = lines.findIndex((line) => /^\s*PACKAGE_DIRS:\s*>-\s*$/.test(line));
  if (start === -1) return [];

  const blockIndent = (lines[start] as string).search(/\S/);
  const dirs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    if (line.search(/\S/) <= blockIndent) break;
    dirs.push(line.trim());
  }
  return dirs;
}

/** Every workspace package `pnpm-workspace.yaml` matches, private ones included. */
function readWorkspaceDirs(): string[] {
  const patterns = readFileSync(new URL("pnpm-workspace.yaml", REPO_ROOT), "utf8")
    .split("\n")
    .map((line) => /^\s*-\s+(\S+)\s*$/.exec(line)?.[1])
    .filter((pattern): pattern is string => pattern !== undefined);

  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(new URL(parent, REPO_ROOT), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(new URL(`${parent}/${entry.name}/package.json`, REPO_ROOT)))
      .map((entry) => `${parent}/${entry.name}`);
  });
}

const PACKAGE_DIRS = readPackageDirs();

describe("release invariants (publish.yml PACKAGE_DIRS)", () => {
  /**
   * Guards the four tests below from passing vacuously: every one of them is
   * trivially true of an empty list, so a workflow edit that renames the key
   * or switches to a flow sequence would silently disable all of them.
   */
  it("parses the published package list out of the workflow", () => {
    expect(PACKAGE_DIRS.length).toBeGreaterThan(0);
    expect(PACKAGE_DIRS).toContain("packages/core");
  });

  it("lists every non-private workspace package, and nothing else", () => {
    const publishable = readWorkspaceDirs().filter((dir) => readJson(dir).private !== true);
    expect([...PACKAGE_DIRS].sort()).toEqual([...publishable].sort());
  });

  it("ships every package at @kavo/core's version (ADR-0004)", () => {
    const core = readJson("packages/core").version as string;
    const versions = Object.fromEntries(PACKAGE_DIRS.map((dir) => [nameOf(dir), readJson(dir).version]));
    expect(versions).toEqual(Object.fromEntries(PACKAGE_DIRS.map((dir) => [nameOf(dir), core])));
  });

  /**
   * npm does not check that a dependency exists at publish time, so a
   * dependent listed first only bites when a run fails partway: it leaves a
   * published package pinning a sibling version that never made it.
   */
  it("orders a package after everything it depends on", () => {
    const published: string[] = [];
    const violations: string[] = [];

    for (const dir of PACKAGE_DIRS) {
      const dependencies = Object.keys((readJson(dir).dependencies ?? {}) as Record<string, string>);
      for (const dependency of dependencies) {
        if (!dependency.startsWith("@kavo/")) continue;
        if (!published.includes(dependency)) violations.push(`${nameOf(dir)} publishes before ${dependency}`);
      }
      published.push(nameOf(dir));
    }

    expect(violations).toEqual([]);
  });

  /**
   * `pnpm pack` rewrites `workspace:` ranges into the version being released;
   * a hardcoded `^0.5.0` is left exactly as written, so it survives the
   * workflow's packed-manifest guard (which searches for `workspace:`) and
   * publishes a dependent pinned to a stale sibling.
   */
  it("depends on siblings through the workspace protocol only", () => {
    const hardcoded = PACKAGE_DIRS.flatMap((dir) =>
      DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries((readJson(dir)[field] ?? {}) as Record<string, string>)
          .filter(([name, range]) => name.startsWith("@kavo/") && !range.startsWith("workspace:"))
          .map(([name, range]) => `${nameOf(dir)} ${field}.${name}: ${range}`),
      ),
    );

    expect(hardcoded).toEqual([]);
  });
});
