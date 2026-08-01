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

3. **Apply the version, in lockstep** (ADR-0004 — [`docs/adr/0004-lockstep-versioning.md`](../../docs/adr/0004-lockstep-versioning.md)):
   set the new version in `packages/core/package.json`,
   `packages/orms/typeorm/package.json`,
   `packages/frameworks/nest/package.json`, and
   `packages/protocols/graphql/package.json`. Leave `examples/*`
   (private, unpublished) alone.

4. **Regenerate the lockfile and gate:**

   ```bash
   pnpm install
   pnpm check
   ```

   If `pnpm check` fails, stop — a release never ships on a red build. Undo
   the version-file edits before stopping so `main` is left clean.

5. **Confirm with the user before doing anything irreversible.** State
   plainly: committing and pushing straight to `main`, then pushing tag
   `vX.Y.Z`, triggers `.github/workflows/publish.yml`, which publishes
   `@kavo/core`, `@kavo/typeorm`, `@kavo/nest`, and `@kavo/graphql` to the
   public npm registry and creates a GitHub Release for the tag — none of
   this is meaningfully undoable once pushed. Wait for an explicit
   go-ahead before step 6.

6. **Commit directly to `main`, then tag and push both:**

   ```bash
   git add packages/core/package.json packages/orms/typeorm/package.json \
           packages/frameworks/nest/package.json packages/protocols/graphql/package.json \
           pnpm-lock.yaml
   git commit -m "chore(release): vX.Y.Z"
   git push origin main
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   The commit body should list the commit subjects since the last tag as a
   short changelog.

7. **Watch the release workflow** and report the result:

   ```bash
   gh run watch --exit-status $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   ```

   If it fails, report the failing step's output — do not retry blindly;
   a failed OIDC trusted-publisher match or a stale npm CLI version are the
   most likely causes.

8. **Report**: the tag, the workflow run URL, the published package
   versions, and the GitHub Release URL
   (`gh release view vX.Y.Z --json url --jq .url`).
