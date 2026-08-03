import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
 * These tests cover three things: the state of the tree itself, the behavior
 * of the gate script, and the workflow wiring that decides when the gate runs
 * and in what order packages go out. The wiring part deliberately reads
 * `publish.yml` as text — the file is the artifact under test, and a test that
 * reimplemented its contents would pass while the real pipeline drifted.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_PATH = resolve(REPO_ROOT, ".github/workflows/publish.yml");
const PUBLISH_COMMAND_PATH = resolve(REPO_ROOT, ".claude/commands/publish.md");
const SCRIPT_PATH = resolve(REPO_ROOT, ".github/scripts/verify-lockstep-versions.mjs");

const workflow = readFileSync(WORKFLOW_PATH, "utf8");

interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifests = new Map<string, Manifest>();

function readManifest(dir: string): Manifest {
  let manifest = manifests.get(dir);
  if (!manifest) {
    manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, dir, "package.json"), "utf8")) as Manifest;
    manifests.set(dir, manifest);
  }
  return manifest;
}

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

/**
 * One step's whole YAML block, so assertions can cover the keys attached to a
 * step (`if:`, `continue-on-error:`) and not just the command it runs.
 */
function readStepBlock(source: string, name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`publish.yml has no step named "${name}"`);

  const header = lines[start]!;
  const stepIndent = header.length - header.trimStart().length;
  const block = [header];

  for (const line of lines.slice(start + 1)) {
    const indent = line.length - line.trimStart().length;
    if (line.trim() !== "" && indent <= stepIndent) break;
    block.push(line);
  }

  return block.join("\n");
}

/**
 * The directories `pnpm-workspace.yaml` globs over, reduced to the roots a
 * filesystem walk has to start from. Deriving them from the workspace file
 * rather than hardcoding `packages` is what keeps the coverage assertion
 * below honest when a package lands somewhere new.
 */
function readWorkspaceRoots(): string[] {
  const source = readFileSync(resolve(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const patterns = [...source.matchAll(/^\s*-\s+(\S+)\s*$/gm)].map((match) => match[1]!);
  return [...new Set(patterns.map((pattern) => pattern.split("/")[0]!))];
}

/** Every workspace package directory under `dir`, at any nesting depth. */
function findWorkspacePackages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
    const child = `${dir}/${entry.name}`;
    if (existsSync(resolve(REPO_ROOT, child, "package.json"))) found.push(child);
    else found.push(...findWorkspacePackages(child));
  }
  return found;
}

const packageDirs = readPackageDirs(workflow);

describe("lockstep versions in this repository", () => {
  /**
   * ADR-0004 is a property of the tree, not only of a release: checking it
   * here means drift fails `pnpm check` on the pull request that introduces
   * it, rather than at a tag push that cannot be cleanly undone.
   *
   * One violation predates this gate — v0.6.0 shipped with `@kavo/prisma`
   * left at 0.5.0, and repairing it (npm registry included) is a separate
   * issue. It is pinned by name rather than tolerated silently: any *new*
   * drift fails this test, and the test fails once prisma is bumped, which
   * is the signal to replace the expectation with an empty list.
   */
  const KNOWN_DRIFT = ["packages/orms/prisma"];

  it("keeps every package on one version, bar the drift v0.6.0 left behind", () => {
    const version = readManifest("packages/core").version;
    const behind = packageDirs.filter((dir) => readManifest(dir).version !== version);

    expect(behind).toEqual(KNOWN_DRIFT);
  });
});

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
    const step = readStepBlock(workflow, "Verify lockstep versions");

    expect(step).toContain("verify-lockstep-versions.mjs");
    expect(step).toContain('"${GITHUB_REF_NAME#v}"');
    // Unquoted on purpose: word splitting is what turns the folded list into
    // one argument per directory, so quoting it would pass a single blob.
    expect(step).toContain(" $PACKAGE_DIRS");
    expect(step).not.toContain('"$PACKAGE_DIRS"');
  });

  it("keeps the gate unconditional", () => {
    const step = readStepBlock(workflow, "Verify lockstep versions");

    // A `continue-on-error` or an `if:` here would reopen the v0.6.0 hole
    // while every other assertion in this file stayed green.
    expect(step).not.toContain("continue-on-error");
    expect(step).not.toMatch(/^\s+if:/m);
  });

  it("keeps the skip-if-already-published guard so a re-run after a partial failure completes", () => {
    expect(workflow).toContain("already published, skipping");
  });

  it("lists every package after the packages it depends on", () => {
    const positionOf = new Map(packageDirs.map((dir, index) => [readManifest(dir).name, index]));

    for (const [index, dir] of packageDirs.entries()) {
      const manifest = readManifest(dir);
      // Peer and optional edges count: `@kavo/graphql` is a lazily-imported
      // optional peer in all but name, and moving it out of `dependencies`
      // must not silently drop it from the ordering rule.
      const edges = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ]);

      for (const dependency of [...edges].filter((name) => name.startsWith("@kavo/"))) {
        const dependencyIndex = positionOf.get(dependency);
        expect(dependencyIndex, `${dependency} is missing from PACKAGE_DIRS`).toBeDefined();
        expect(dependencyIndex, `${dir} is published before its dependency ${dependency}`).toBeLessThan(index);
      }
    }
  });

  it("covers exactly the publishable workspace packages", () => {
    const publishable = readWorkspaceRoots()
      .flatMap((root) => findWorkspacePackages(root))
      .filter((dir) => readManifest(dir).private !== true);

    expect([...packageDirs].sort()).toEqual(publishable.sort());
  });

  it("keeps /publish's package table in the order PACKAGE_DIRS publishes", () => {
    // publish.md names PACKAGE_DIRS the authority and calls a disagreement
    // "a bug to fix in the same pass" — this is what notices.
    const doc = readFileSync(PUBLISH_COMMAND_PATH, "utf8");
    const rows = [...doc.matchAll(/^\s*\|\s*`(packages\/[^`]+)`\s*\|/gm)].map((match) => match[1]!);

    expect(rows).toEqual(packageDirs);
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
  function writeFixture(name: string, packages: Record<string, unknown>): { cwd: string; dirs: string[] } {
    const cwd = join(fixtureRoot, name);
    for (const [dir, manifest] of Object.entries(packages)) {
      mkdirSync(join(cwd, dir), { recursive: true });
      writeFileSync(join(cwd, dir, "package.json"), JSON.stringify(manifest));
    }
    return { cwd, dirs: Object.keys(packages) };
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

  // One run has to report everything it knows: an operator who fixes only the
  // unreadable directory would otherwise spend a second tag discovering the
  // stale version the script had already seen.
  it("reports stale versions alongside unreadable manifests in one run", () => {
    const { cwd } = writeFixture("both-problems", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
      "packages/orms/prisma": { name: "@kavo/prisma", version: "0.5.0" },
    });

    const result = runCheck(cwd, ["0.6.0", "packages/core", "packages/orms/prisma", "packages/typo"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("@kavo/prisma (packages/orms/prisma/package.json) is 0.5.0, expected 0.6.0");
    expect(result.stderr).toContain("packages/typo/package.json");
  });

  it("exits 2 without an expected version or any package directories", () => {
    const { cwd } = writeFixture("no-args", {
      "packages/core": { name: "@kavo/core", version: "0.6.0" },
    });

    expect(runCheck(cwd, ["0.6.0"]).status).toBe(2);
    expect(runCheck(cwd, []).status).toBe(2);
    expect(runCheck(cwd, []).stderr).toContain("usage:");
  });
});
