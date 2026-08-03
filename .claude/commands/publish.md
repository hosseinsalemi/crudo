---
description: Bump @kavo/* to the next lockstep version and publish via a git tag
argument-hint: "[patch|minor|major to override auto-detection]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Bash(pnpm install:*), Bash(pnpm check:*), Bash(pnpm build:*), Bash(pnpm pack:*), Bash(npm view:*), Bash(tar:*), Read, Grep, Glob
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Current lockstep version: !`node -p "require('./packages/core/package.json').version"`
- Last release tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "none"`
- Tags on HEAD already: !`git tag --points-at HEAD`
- Commits since last tag: !`git log "$(git describe --tags --abbrev=0 2>/dev/null)"..HEAD --oneline 2>/dev/null || git log --oneline -20`
- Remote: !`git remote -v | head -1 || echo "NO REMOTE"`

## Your task

Ship the next `@kavo/*` release, directly from `main`. Argument: **$ARGUMENTS**

This command only ever operates on `main`. It does not create branches, commit
developer changes, or open a PR — it bumps the version, commits that bump
straight to `main`, tags it, and pushes the tag to trigger the publish
workflow.

**Packages reach npm one way only: a pushed `v*.*.*` tag.** That tag triggers
`.github/workflows/publish.yml`, and that workflow is the only thing that
publishes. Never run `npm publish` or `pnpm publish` from a package directory,
not even for a one-off fix. Every `packages/*/package.json` depends on its
siblings through `workspace:^`, and only `pnpm pack` rewrites that into a real
semver range; a direct publish ships the literal `workspace:^` to the registry,
where no package manager can resolve it (`npm error code
EUNSUPPORTEDPROTOCOL`, `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`). That is exactly how
`@kavo/prisma@0.5.0` and `@kavo/mongoose@0.6.0` shipped uninstallable, and npm
forbids republishing a version, so the only repair was a new release plus an
`npm deprecate` on the burned ones. The workflow now fails on a packed tarball
that still contains `workspace:` — but a hand-run publish never reaches that
guard, which is why the rule is the tag and nothing else.

1. **Refuse and stop if**: the current branch isn't `main`; `main` is not up
   to date with `origin/main`; the working tree is dirty (this command never
   touches or commits pre-existing changes — ask the user to commit or stash
   them first); HEAD already has a tag pointing at it (already released); or
   there are no commits since the last tag (nothing to release).

2. **Determine the version bump.** If `$ARGUMENTS` is exactly `patch`,
   `minor`, or `major`, use that. Otherwise classify every commit since the
   last tag by its Conventional Commits type prefix, using the shared type
   vocabulary from the **conventions** skill (`feat`, `fix`, `chore`, `test`,
   `docs`, `refactor`, `perf`, `ci`):
   - a `!` after the type (`feat!:`, `fix!:`, …) or a `BREAKING CHANGE:`
     footer anywhere in a commit body → **major**
   - any `feat:` commit → **minor**
   - anything else (`fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `ci:`,
     `test:`, …) → **patch**

   Take the highest severity found. Bump `packages/core/package.json`'s
   current version by that level (standard semver: major resets minor/patch
   to 0, minor resets patch to 0). State the computed version and _why_
   (which commits triggered the bump level) before touching any files.

3. **Apply the version, in lockstep** (ADR-0004 — [`docs/internals/adr/0004-lockstep-versioning.md`](../../docs/internals/adr/0004-lockstep-versioning.md)):
   set the new version in the `package.json` of **every** published package.
   `PACKAGE_DIRS` in `.github/workflows/publish.yml` is the single source of
   truth for that set — read it and bump exactly those. Today it is all seven,
   in the topological order the workflow publishes them (dependents last):

   | Directory                    | Package          |
   | ---------------------------- | ---------------- |
   | `packages/core`              | `@kavo/core`     |
   | `packages/orms/typeorm`      | `@kavo/typeorm`  |
   | `packages/orms/prisma`       | `@kavo/prisma`   |
   | `packages/orms/mongoose`     | `@kavo/mongoose` |
   | `packages/protocols/graphql` | `@kavo/graphql`  |
   | `packages/protocols/mcp`     | `@kavo/mcp`      |
   | `packages/frameworks/nest`   | `@kavo/nest`     |

   If this table and `PACKAGE_DIRS` ever disagree, `PACKAGE_DIRS` wins — it is
   what actually publishes — and the table is a bug to fix in the same pass.
   Leave `examples/*` (private, unpublished) alone.

   Then read the versions back and confirm they are identical. A mismatch
   fails the release in the workflow's version-and-order guard, and catching
   it here costs nothing while catching it there burns a tag:

   ```bash
   for dir in <PACKAGE_DIRS from above>; do
     node -p "const p = require('./$dir/package.json'); p.name + ' ' + p.version"
   done
   ```

   `pnpm check` in step 4 asserts the same thing via
   `packages/core/tests/release-invariants.spec.ts`, so a mismatch here fails
   the gate too — but read the versions anyway, because step 4 is where you
   would otherwise discover it after a full build.

4. **Regenerate the lockfile and gate:**

   ```bash
   pnpm install
   pnpm check
   ```

   If `pnpm check` fails, stop — a release never ships on a red build. Undo
   the version-file edits before stopping so `main` is left clean.

5. **Verify every package already exists on the registry.** A package that has
   never been published cannot go out through this workflow, because npm's
   trusted publishers are configured per package on npmjs.com and a package
   with no versions has no settings page to configure. First publishes are
   manual and out-of-band — but they happen **during** the release, not before
   it, for the reason
   [Bootstrapping a first publish](#bootstrapping-a-first-publish) gives:

   ```bash
   for dir in <PACKAGE_DIRS from step 3>; do
     NAME=$(node -p "require('./$dir/package.json').name")
     npm view "$NAME" version >/dev/null 2>&1 || echo "NEVER PUBLISHED: $NAME"
   done
   ```

   If anything prints, **tell the user now, and read
   [Bootstrapping a first publish](#bootstrapping-a-first-publish) at the end
   of this file before going on** — but do not treat it as a reason to stop.
   The bootstrap happens in step 8, in the middle of the release, because it
   can only be done safely once the tag has put that package's siblings on the
   registry. Carry on through steps 6 and 7 as normal.

   `publish.yml` publishes `PACKAGE_DIRS` in topological order, so the run will
   stop at the unpublished package with nothing that depends on it published
   yet — that ordering is what keeps this recoverable instead of leaving an
   uninstallable `@kavo/nest` on the registry forever.

6. **Confirm with the user before doing anything irreversible.** State
   plainly: committing and pushing straight to `main`, then pushing tag
   `vX.Y.Z`, triggers `.github/workflows/publish.yml`, which publishes every
   package in `PACKAGE_DIRS` to the public npm registry and creates a GitHub
   Release for the tag — none of this is meaningfully undoable once pushed.

   **Name every package explicitly in the prompt**, enumerated from the
   `PACKAGE_DIRS` you read in step 3 rather than from memory or from a list
   written here — currently `@kavo/core`, `@kavo/typeorm`, `@kavo/prisma`,
   `@kavo/mongoose`, `@kavo/nest`, `@kavo/graphql`, and `@kavo/mcp`, all seven
   at the same version per ADR-0004. A confirmation gate that names a subset
   understates an irreversible public release, which is a release hazard
   rather than a cosmetic slip. Wait for an explicit go-ahead before step 7.

7. **Commit directly to `main`, then tag and push both.** Stage by directory
   rather than by enumerating packages — step 1 already refused to run on a
   dirty tree, so the only modified files are the version bumps from step 3 and
   the lockfile. A hardcoded list here is the same drift hazard as a hardcoded
   list at the gate, and a worse one, because a missed package fails _green_:
   the release commit lands without that bump, `publish.yml` only compares
   `packages/core`'s version to the tag, and the publish loop then sees the old
   version already on the registry and prints `already published, skipping`.

   ```bash
   git add packages pnpm-lock.yaml
   git commit -m "chore(release): vX.Y.Z"
   git push origin main
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   The commit body should list the commit subjects since the last tag as a
   short changelog.

8. **Watch the release workflow** and report the result:

   ```bash
   gh run watch --exit-status $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   ```

   If it fails, report the failing step's output — do not retry blindly;
   a failed OIDC trusted-publisher match or a stale npm CLI version are the
   most likely causes.

   If it failed publishing a package step 5 flagged as never published, that
   is the expected path, not a surprise: follow
   [Bootstrapping a first publish](#bootstrapping-a-first-publish) below, then
   come back here and watch the re-run.

9. **Report**: the tag, the workflow run URL, the published package
   versions, and the GitHub Release URL
   (`gh release view vX.Y.Z --json url --jq .url`).

## Bootstrapping a first publish

Not a step — a sub-procedure step 8 sends you to, and returns from. Nothing
below re-enters the numbered sequence above; when it is done, go back to
step 8.

A package with no versions on npm has no settings page, so it has no trusted
publisher, so `publish.yml` cannot publish it. Bootstrapping it by hand is the
**only** sanctioned publish outside the tag, and it happens _during_ the
release — after the tag, never before it. `pnpm pack` rewrites `workspace:^`
into `^X.Y.Z`, the version step 3 just bumped to, which nothing has published
yet; publish that tarball before the release and then abort the release (a
declined confirmation at step 6, a red gate, a failed tag push) and you have
shipped a version pinned to a sibling that does not exist, which npm will not
let you replace.

Three things must be true of the tarball, and **a tarball free of
`workspace:` is not the same as a tarball that installs**:

- It is a **packed tarball** — never `npm publish` from inside the package
  directory, the shortcut that shipped `@kavo/prisma@0.5.0` and
  `@kavo/mongoose@0.6.0` with an unresolvable `workspace:^`.
- Every `@kavo/*` range in it **already resolves on the registry**.
- It **contains the build**. No package here has a `prepack` script, so
  `pnpm pack` will cheerfully produce a manifest-only tarball from a tree with
  no `dist/` and exit 0 — and npm will not let you replace that version
  either.

1. Build, then pack from the release commit:

   ```bash
   pnpm build
   (cd <dir> && pnpm pack --pack-destination /tmp/kavo-bootstrap)
   ```

2. Verify all three. Any failure means do not publish:

   ```bash
   TARBALL=/tmp/kavo-bootstrap/<tarball>
   MANIFEST=$(tar -xzOf "$TARBALL" package/package.json)

   if printf '%s' "$MANIFEST" | grep -q '"workspace:'; then
     echo "unresolved workspace: range — do not publish" >&2
     exit 1
   fi

   ENTRY="package/$(printf '%s' "$MANIFEST" | node -e '
     let raw = "";
     process.stdin.on("data", (chunk) => (raw += chunk));
     process.stdin.on("end", () => {
       const pkg = JSON.parse(raw);
       const entry = pkg.exports?.["."]?.default ?? pkg.main ?? "index.js";
       console.log(entry.replace(/^\.\//, ""));
     });
   ')"
   tar -tzf "$TARBALL" | grep -qx "$ENTRY" || {
     echo "tarball has no build output ($ENTRY) — run pnpm build" >&2
     exit 1
   }

   for spec in $(printf '%s' "$MANIFEST" | node -e '
     let raw = "";
     process.stdin.on("data", (chunk) => (raw += chunk));
     process.stdin.on("end", () => {
       const pkg = JSON.parse(raw);
       for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
         if (name.startsWith("@kavo/")) console.log(name + "@" + range);
       }
     });
   '); do
     npm view "$spec" version >/dev/null 2>&1 || {
       echo "pins a version that is not on the registry: $spec" >&2
       exit 1
     }
   done
   ```

3. Get the user's explicit go-ahead — this is public and irreversible — then
   publish the tarball and configure its trusted publisher on npmjs.com
   (`kavo-labs/kavo` + `publish.yml`):

   ```bash
   npm publish "$TARBALL" --access public
   ```

   Neither `npm publish` nor `pnpm publish` is in this command's
   `allowed-tools`, and `pnpm` is granted per-subcommand for the same reason:
   the permission prompt is that go-ahead. Do not pre-authorize it away, and
   do not widen the entry to `Bash(pnpm:*)` — that hands back `pnpm publish`,
   half of what the rule at the top of this file forbids.

4. Re-run the failed workflow. The `already published, skipping` branch walks
   past everything that went out on the first attempt and publishes the rest:

   ```bash
   gh run rerun <run-id> --failed
   ```

   Then **return to step 8** and watch it. That first version lacks OIDC
   provenance; every later release of it through the workflow will have it.
