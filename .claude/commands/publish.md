---
description: Bump @kavo/* to the next lockstep version and publish via a git tag
argument-hint: "[patch|minor|major to override auto-detection]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Bash(gh:*), Bash(node:*), Read, Grep, Glob
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
   truth for that set — read it and bump exactly those. Today it is all seven:

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
   manual, out-of-band, and have to happen **before** the tag:

   ```bash
   for dir in <PACKAGE_DIRS from step 3>; do
     NAME=$(node -p "require('./$dir/package.json').name")
     npm view "$NAME" version >/dev/null 2>&1 || echo "NEVER PUBLISHED: $NAME"
   done
   ```

   If anything prints, **stop and tell the user before tagging.** Skipping this
   is not a cosmetic risk: the run dies on the package that has no trusted
   publisher, by which point everything ahead of it in `PACKAGE_DIRS` is
   already public and, past npm's unpublish window, cannot be withdrawn.
   `PACKAGE_DIRS` is ordered so that a package publishes only after the
   packages it depends on, which at least keeps what did go out internally
   consistent — nothing published pointing at a sibling version that does not
   exist — but half a lockstep release is still a broken release.

   To bootstrap one: publish it by hand, then configure its trusted publisher
   on npmjs.com (`kavo-labs/kavo` + `publish.yml`), confirm `npm view` resolves,
   and only then release. That first version will lack OIDC provenance; every
   later release of it through the workflow will have it.

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
   list at the gate. A missed package no longer fails _green_: step 4's
   `pnpm check` fails on it first (`tests/release-workflow.spec.ts` asserts
   every `PACKAGE_DIRS` package carries one version), which is the point at
   which nothing irreversible has happened yet. `publish.yml`'s
   `Verify lockstep versions` step is the backstop behind it, and by the time
   that one speaks the tag is already pushed — the fix then costs a commit on
   `main` and a re-tag.

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
