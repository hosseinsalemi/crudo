---
description: Bump @kavo/* to the next lockstep version and publish via a git tag
argument-hint: "[patch|minor|major to override auto-detection]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Bash(gh:*), Bash(node:*), Bash(npm view:*), Bash(tar:*), Read, Grep, Glob
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

   Then read the versions back and confirm they are identical — the workflow
   fails the release on a mismatch (`Verify lockstep versions`), and catching
   it here costs nothing while catching it there burns a tag:

   ```bash
   for dir in <PACKAGE_DIRS from above>; do
     node -p "const p = require('./$dir/package.json'); p.name + ' ' + p.version"
   done
   ```

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
   it (the sequence below explains why):

   ```bash
   for dir in <PACKAGE_DIRS from step 3>; do
     NAME=$(node -p "require('./$dir/package.json').name")
     npm view "$NAME" version >/dev/null 2>&1 || echo "NEVER PUBLISHED: $NAME"
   done
   ```

   If anything prints, **stop and tell the user before tagging**, then follow
   the bootstrap sequence below. `publish.yml` publishes `PACKAGE_DIRS` in
   topological order, so the run will stop at the unpublished package with
   nothing that depends on it published yet — that ordering is what keeps a
   failure here recoverable instead of leaving an uninstallable `@kavo/nest`
   on the registry forever.

   Bootstrapping is the **only** sanctioned publish outside the tag, and it
   has two hard rules. First, publish a **packed tarball** — never
   `npm publish` from inside the package directory, the shortcut that shipped
   `@kavo/prisma@0.5.0` and `@kavo/mongoose@0.6.0` with an unresolvable
   `workspace:^`. Second, every `@kavo/*` range in that tarball must **already
   resolve on the registry**. `pnpm pack` rewrites `workspace:^` into
   `^X.Y.Z` — the version step 3 just bumped to, which nothing has published
   yet. Publish that tarball before the release and then abort it (a declined
   confirmation at step 6, a red gate, a failed tag push) and you have shipped
   a version pinned to a sibling that does not exist, which npm will not let
   you replace. **A tarball free of `workspace:` is not the same as a tarball
   that installs.**

   So bootstrap _during_ the release, once the tag has put the siblings on the
   registry:

   1. Tag and push as normal (steps 6-7). The run publishes `@kavo/core` and
      everything else ahead of the gap, then fails on the unpublished package.
   2. Pack it from the release commit and verify the tarball on both counts:

      ```bash
      (cd <dir> && pnpm pack --pack-destination /tmp/kavo-bootstrap)
      MANIFEST=$(tar -xzOf /tmp/kavo-bootstrap/<tarball> package/package.json)

      if printf '%s' "$MANIFEST" | grep -q '"workspace:'; then
        echo "unresolved workspace: range — do not publish" >&2
        exit 1
      fi

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

   3. Get the user's explicit go-ahead — this is public and irreversible —
      then `npm publish /tmp/kavo-bootstrap/<tarball> --access public` and
      configure its trusted publisher on npmjs.com (`kavo-labs/kavo` +
      `publish.yml`). `npm publish` is deliberately absent from this command's
      `allowed-tools`: the permission prompt is that go-ahead, so do not
      pre-authorize it away.
   4. Re-run the failed workflow (`gh run rerun <run-id> --failed`). The
      `already published, skipping` branch walks past everything that went out
      on the first attempt and publishes the rest.

   That first version lacks OIDC provenance; every later release of it through
   the workflow will have it.

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

9. **Report**: the tag, the workflow run URL, the published package
   versions, and the GitHub Release URL
   (`gh release view vX.Y.Z --json url --jq .url`).
