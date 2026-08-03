import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The release pipeline, as a set of assertions.
 *
 * ADR-0004 says every `@kavo/*` package ships on one version, but until now
 * nothing enforced it: `publish.yml` compared the tag against `@kavo/core`
 * alone, so a package left behind packed stale and was then skipped by the
 * already-published guard — a green release that shipped one package short.
 * That is not a hypothetical; it is how v0.6.0 left `@kavo/prisma` at 0.5.0.
 *
 * These tests cover both halves of the fix: the behavior of the gate script
 * itself, and the workflow wiring that decides when it runs and in what order
 * packages go out. The wiring half deliberately reads `publish.yml` as text —
 * the file is the artifact under test, and a test that reimplemented its
 * contents would pass while the real pipeline drifted.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_PATH = resolve(REPO_ROOT, ".github/workflows/publish.yml");
const SCRIPT_PATH = resolve(REPO_ROOT, ".github/scripts/verify-lockstep-versions.mjs");

const workflow = readFileSync(WORKFLOW_PATH, "utf8");

/**
 * The entries of the `PACKAGE_DIRS: >-` folded block — the workflow's single
 * source of truth for which packages get released.
 */
function readPackageDirs(source: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === "PACKAGE_DIRS: >-");
  if (start === -1) {
    throw new Error("publish.yml no longer declares PACKAGE_DIRS as a folded block");
  }

  const header = lines[start]!;
  const keyIndent = header.length - header.trimStart().length;
  const dirs: string[] = [];

  for (const line of lines.slice(start + 1)) {
    const indent = line.length - line.trimStart().length;
    // The block ends at the first blank or dedented line.
    if (line.trim() === "" || indent <= keyIndent) break;
    dirs.push(line.trim());
  }

  return dirs;
}

/** Step names in the order the job runs them. */
function readStepNames(source: string): string[] {
  return [...source.matchAll(/^\s*- name: (.+)$/gm)].map((match) => match[1]!.trim());
}

/** Every workspace package directory under `packages/`, at any nesting depth. */
function findWorkspacePackages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
    const child = `${dir}/${entry.name}`;
    if (readdirSync(resolve(REPO_ROOT, child)).includes("package.json")) found.push(child);
    else found.push(...findWorkspacePackages(child));
  }
  return found;
}

function readManifest(dir: string): {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, dir, "package.json"), "utf8"));
}

const packageDirs = readPackageDirs(workflow);

describe("publish.yml wiring", () => {
  it("declares a non-empty PACKAGE_DIRS list of directories that exist", () => {
    expect(packageDirs.length).toBeGreaterThan(0);
    for (const dir of packageDirs) {
      expect(() => readManifest(dir)).not.toThrow();
    }
  });

  it("verifies lockstep versions before anything is packed or published", () => {
    const steps = readStepNames(workflow);
    const verify = steps.indexOf("Verify lockstep versions");
    const pack = steps.indexOf("Pack packages");
    const publish = steps.indexOf("Publish packages");

    expect(verify).toBeGreaterThanOrEqual(0);
    expect(pack).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThanOrEqual(0);
    expect(verify).toBeLessThan(pack);
    expect(verify).toBeLessThan(publish);
  });

  it("runs the gate script over the whole PACKAGE_DIRS list, not one package", () => {
    expect(workflow).toContain(
      'node .github/scripts/verify-lockstep-versions.mjs "${GITHUB_REF_NAME#v}" $PACKAGE_DIRS',
    );
  });

  it("keeps the skip-if-already-published guard so a re-run after a partial failure completes", () => {
    expect(workflow).toContain("already published, skipping");
  });

  it("lists every package after the packages it depends on", () => {
    const positionOf = new Map(packageDirs.map((dir, index) => [readManifest(dir).name, index]));

    for (const [index, dir] of packageDirs.entries()) {
      const dependencies = Object.keys(readManifest(dir).dependencies ?? {});
      for (const dependency of dependencies.filter((name) => name.startsWith("@kavo/"))) {
        const dependencyIndex = positionOf.get(dependency);
        expect(dependencyIndex, `${dependency} is missing from PACKAGE_DIRS`).toBeDefined();
        expect(dependencyIndex, `${dir} is published before its dependency ${dependency}`).toBeLessThan(index);
      }
    }
  });

  it("covers exactly the publishable workspace packages", () => {
    const publishable = findWorkspacePackages("packages").filter((dir) => readManifest(dir).private !== true);
    expect([...packageDirs].sort()).toEqual(publishable.sort());
  });
});

describe("verify-lockstep-versions", () => {
  let fixtureRoot: string;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "kavo-lockstep-"));
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  /** Writes a throwaway workspace and returns the directories, in order. */
  function writeFixture(name: string, manifests: Record<string, unknown>): { cwd: string; dirs: string[] } {
    const cwd = join(fixtureRoot, name);
    for (const [dir, manifest] of Object.entries(manifests)) {
      mkdirSync(join(cwd, dir), { recursive: true });
      writeFileSync(join(cwd, dir, "package.json"), JSON.stringify(manifest));
    }
    return { cwd, dirs: Object.keys(manifests) };
  }

  function runCheck(cwd: string, args: string[]) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: "utf8" });
  }

  it("passes when every package carries the tag's version", () => {
    const { cwd, dirs } = writeFixture("all-aligned", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
      "packages/orms/prisma": { name: "@kavo/prisma", version: "0.6.0" },
      "packages/frameworks/nest": { name: "@kavo/nest", version: "0.6.0" },
    });

    const result = runCheck(cwd, ["0.6.0", ...dirs]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("all 3 packages are at 0.6.0");
  });

  // The v0.6.0 release itself: six packages bumped, @kavo/prisma left behind.
  // The old core-only check passed this; the gate must not.
  it("fails the release when a single package was left behind", () => {
    const { cwd, dirs } = writeFixture("one-left-behind", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
      "packages/orms/typeorm": { name: "@kavo/typeorm", version: "0.6.0" },
      "packages/orms/prisma": { name: "@kavo/prisma", version: "0.5.0" },
      "packages/orms/mongoose": { name: "@kavo/mongoose", version: "0.6.0" },
      "packages/protocols/graphql": { name: "@kavo/graphql", version: "0.6.0" },
      "packages/protocols/mcp": { name: "@kavo/mcp", version: "0.6.0" },
      "packages/frameworks/nest": { name: "@kavo/nest", version: "0.6.0" },
    });

    const result = runCheck(cwd, ["0.6.0", ...dirs]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@kavo/prisma (packages/orms/prisma/package.json) is 0.5.0, expected 0.6.0");
    expect(result.stderr).toContain("1 of 7 packages are not at 0.6.0");
    // The packages that were bumped are not named as problems.
    expect(result.stderr).not.toContain("@kavo/core");
  });

  it("names every mismatching package, not just the first", () => {
    const { cwd, dirs } = writeFixture("several-left-behind", {
      "packages/core": { name: "@kavo/core", version: "1.0.0" },
      "packages/orms/prisma": { name: "@kavo/prisma", version: "0.5.0" },
      "packages/protocols/mcp": { name: "@kavo/mcp", version: "0.6.0" },
    });

    const result = runCheck(cwd, ["1.0.0", ...dirs]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@kavo/prisma (packages/orms/prisma/package.json) is 0.5.0, expected 1.0.0");
    expect(result.stderr).toContain("@kavo/mcp (packages/protocols/mcp/package.json) is 0.6.0, expected 1.0.0");
    expect(result.stderr).toContain("2 of 3 packages are not at 1.0.0");
  });

  it("fails when the tag itself is ahead of every package", () => {
    const { cwd, dirs } = writeFixture("tag-ahead", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
    });

    const result = runCheck(cwd, ["0.7.0", ...dirs]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@kavo/core (packages/core/package.json) is 0.6.0, expected 0.7.0");
  });

  it("treats a manifest with no version field as a mismatch rather than a pass", () => {
    const { cwd, dirs } = writeFixture("no-version-field", {
      "packages/core": { name: "@kavo/core" },
    });

    const result = runCheck(cwd, ["0.6.0", ...dirs]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("<no version field>");
  });

  it("exits 2 when a listed directory has no manifest, instead of reading as all clear", () => {
    const { cwd } = writeFixture("missing-manifest", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
    });

    const result = runCheck(cwd, ["0.6.0", "packages/core", "packages/gone"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Cannot read");
    expect(result.stderr).toContain("packages/gone");
  });

  it("exits 2 when invoked with no package directories", () => {
    const { cwd } = writeFixture("no-args", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
    });

    expect(runCheck(cwd, ["0.6.0"]).status).toBe(2);
    expect(runCheck(cwd, []).status).toBe(2);
    expect(runCheck(cwd, []).stderr).toContain("usage:");
  });

  it("gates the real repository against its own PACKAGE_DIRS list", () => {
    const version = readManifest("packages/core").version!;
    const result = runCheck(REPO_ROOT, [version, ...packageDirs]);

    // Whatever the answer is, the gate must reach a verdict on every package
    // rather than erroring out on the list the workflow actually passes it.
    expect(result.status).not.toBe(2);
    expect(result.stderr).not.toContain("Cannot read");
  });
});
