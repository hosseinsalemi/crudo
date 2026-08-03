/**
 * The mechanical gate for ADR-0004 lockstep versioning
 * (docs/internals/adr/0004-lockstep-versioning.md): every published package
 * must carry the version its release tag names, verified *before* anything
 * reaches the registry.
 *
 * Without this the failure is silent and post-publish. A package left behind
 * still packs cleanly, and then the skip-if-already-published guard in
 * `publish.yml` sees that exact `name@version` on the registry and prints
 * "already published, skipping" — so the release goes green having shipped one
 * package short. That is how v0.6.0 left `@kavo/prisma` at 0.5.0.
 *
 * Usage: node .github/scripts/verify-lockstep-versions.mjs <version> <dir>...
 *
 * Package directories are resolved against the current working directory, so
 * the workflow can hand it `$PACKAGE_DIRS` verbatim from the repo root.
 *
 * Exit codes: 0 every package matches, 1 at least one mismatch, 2 bad usage or
 * an unreadable manifest (a broken invocation must never read as "all clear").
 * Every directory is inspected before exiting: an operator fixing a release
 * gets the whole list in one run rather than one problem per re-tag.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const USAGE = "usage: verify-lockstep-versions.mjs <expected-version> <package-dir>...";

const [expected, ...dirs] = process.argv.slice(2);

if (!expected || dirs.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const unreadable = [];
const mismatches = [];

for (const dir of dirs) {
  const manifestPath = resolve(dir, "package.json");

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    unreadable.push({ dir, reason: error.message });
    continue;
  }

  if (manifest.version !== expected) {
    mismatches.push({
      name: manifest.name ?? dir,
      dir,
      // A manifest with no `version` at all is a mismatch, not a pass.
      actual: manifest.version ?? "<no version field>",
    });
  }
}

if (mismatches.length > 0) {
  console.error(
    `Lockstep version check failed: ${mismatches.length} of ${dirs.length} packages are not at ${expected}.`,
  );
  for (const { name, dir, actual } of mismatches) {
    console.error(`  ${name} (${dir}/package.json) is ${actual}, expected ${expected}`);
  }
}

if (unreadable.length > 0) {
  console.error(`Cannot read ${unreadable.length} of ${dirs.length} package manifests:`);
  for (const { dir, reason } of unreadable) {
    console.error(`  ${dir}/package.json — ${reason}`);
  }
}

if (unreadable.length > 0) {
  console.error("");
  console.error("Every listed directory must be a package. Fix PACKAGE_DIRS, then re-tag the release.");
  process.exit(2);
}

if (mismatches.length > 0) {
  console.error("");
  console.error("ADR-0004 requires every @kavo/* package to ship on one version.");
  console.error("Bump the packages listed above, then re-tag the release.");
  process.exit(1);
}

console.log(`Lockstep version check passed: all ${dirs.length} packages are at ${expected}.`);
