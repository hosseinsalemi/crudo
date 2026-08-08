/**
 * Bun-runtime compatibility smoke check: every published package's compiled
 * `dist/` entry point must be importable under Bun with no crash.
 *
 * This deliberately imports the *compiled* output, not TypeScript sources.
 * Bun's own transpiler cannot emit `emitDecoratorMetadata` the way `tsc`
 * (and the SWC vitest plugin) do, so running the TypeORM/Nest-decorated
 * sources directly under Bun fails for reasons unrelated to Bun
 * compatibility. Building first with `tsc` sidesteps that: decorator
 * metadata is already baked into plain JS by the time Bun ever sees it, so
 * this checks the thing a Bun consumer actually experiences — "does
 * `import` work" — not whether Bun can compile TypeScript decorators,
 * which it never needs to.
 *
 * Deliberately a smoke check, not a behavior test: the full suite already
 * covers behavior under Node/Vitest. This only needs to catch a package
 * whose compiled output throws on import under a different runtime (e.g. a
 * Node-only API leaking into a hot path).
 *
 * Packages are discovered from `pnpm-workspace.yaml` rather than hardcoded,
 * so this never drifts from `publish.yml`'s `PACKAGE_DIRS` — both land on
 * the same set of publishable (non-`private`) workspace packages by
 * construction, the same reasoning `tests/release-workflow.spec.ts`
 * "covers exactly the publishable workspace packages" applies.
 *
 * Usage: bun run .github/scripts/bun-compat-check.mjs
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

function readWorkspaceRoots() {
  const source = readFileSync(resolve(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "packages:");
  if (start === -1) {
    throw new Error("pnpm-workspace.yaml no longer declares a `packages:` list");
  }

  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    const entry = /^\s+-\s+["']?([^"'\s]+)/.exec(line);
    if (!entry) break;
    patterns.push(entry[1]);
  }

  return [...new Set(patterns.map((pattern) => pattern.split("/")[0]))];
}

function findWorkspacePackages(dir) {
  const found = [];
  for (const entry of readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
    const child = `${dir}/${entry.name}`;
    if (existsSync(resolve(REPO_ROOT, child, "package.json"))) found.push(child);
    else found.push(...findWorkspacePackages(child));
  }
  return found;
}

function readManifest(dir) {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, dir, "package.json"), "utf8"));
}

const dirs = readWorkspaceRoots()
  .flatMap((root) => findWorkspacePackages(root))
  .filter((dir) => readManifest(dir).private !== true);

const failures = [];

for (const dir of dirs) {
  const manifest = readManifest(dir);
  const entry = manifest.exports?.["."]?.default ?? manifest.main ?? "index.js";
  const entryPath = resolve(REPO_ROOT, dir, entry);

  try {
    const imported = await import(pathToFileURL(entryPath).href);
    const exportNames = Object.keys(imported);
    if (exportNames.length === 0) {
      throw new Error("module imported but exposed no exports");
    }
    console.log(`${manifest.name}: ok (${exportNames.length} exports)`);
  } catch (error) {
    failures.push({ name: manifest.name ?? dir, dir, error });
  }
}

if (failures.length > 0) {
  console.error(`\nBun compatibility check failed: ${failures.length} of ${dirs.length} packages failed to import.`);
  for (const { name, dir, error } of failures) {
    console.error(`  ${name} (${dir}) — ${error.message}`);
  }
  process.exit(1);
}

console.log(`\nBun compatibility check passed: all ${dirs.length} packages imported cleanly.`);
