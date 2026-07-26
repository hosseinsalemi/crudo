---
description: Bump @kavo/* to the next lockstep version and publish via a git tag
argument-hint: "[patch|minor|major to override auto-detection, or 'tag' to force tag-only mode]"
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

Ship the next `@kavo/*` release. Argument: **$ARGUMENTS**

This is a two-phase command — run it once to prepare the release PR, then
again after that PR is merged to cut and push the tag. Figure out which
phase applies from the context above:

- **Prepare phase** applies when `packages/core/package.json`'s version has
  no tag pointing at the current commit (i.e. HEAD isn't a tagged release
  yet) — this is the normal case on a feature/main state with unreleased
  commits.
- **Tag phase** applies when you're on `main`, the tree is clean, `main` is
  up to date with `origin/main`, and the *current* lockstep version has no
  tag yet but the commit that set that version (a `chore(release): vX.Y.Z`
  commit) is already on `main` — i.e. the prepare-phase PR was just merged.
  `$ARGUMENTS` of `tag` forces this phase explicitly if detection is wrong.

---

### Prepare phase

1. **Refuse and stop if**: the working tree is dirty (run `/commit` first),
   or there are no commits since the last tag (nothing to release).

2. **Determine the version bump.** If `$ARGUMENTS` is exactly `patch`,
   `minor`, or `major`, use that. Otherwise classify every commit since the
   last tag by Conventional Commits prefix:
   - a `!` after the type (`feat!:`, `fix!:`, …) or a `BREAKING CHANGE:`
     footer anywhere in a commit body → **major**
   - any `feat:` commit → **minor**
   - anything else (`fix:`, `chore:`, `docs:`, `refactor:`, `test:`, …) →
     **patch**

   Take the highest severity found. Bump `packages/core/package.json`'s
   current version by that level (standard semver: major resets minor/patch
   to 0, minor resets patch to 0). State the computed version and *why*
   (which commits triggered the bump level) before touching any files.

3. **Apply the version, in lockstep** (ADR-0004 — [`packages/docs/adr/0004-lockstep-versioning.md`](../../packages/docs/adr/0004-lockstep-versioning.md)):
   set the new version in `packages/core/package.json`,
   `packages/orms/typeorm/package.json`, and
   `packages/frameworks/nest/package.json`. Leave `packages/examples`
   (private, unpublished) alone.

4. **Regenerate the lockfile and gate:**

   ```bash
   pnpm install
   pnpm check
   ```

   If `pnpm check` fails, stop — a release never ships on a red build.

5. **Commit** on a new branch `release/vX.Y.Z`:

   ```bash
   git checkout -b release/vX.Y.Z
   git add packages/core/package.json packages/orms/typeorm/package.json \
           packages/frameworks/nest/package.json pnpm-lock.yaml
   git commit -m "chore(release): vX.Y.Z"
   ```

   The commit body should list the commit subjects since the last tag as a
   short changelog.

6. **Push and open a PR:**

   ```bash
   git push -u origin release/vX.Y.Z
   gh pr create --title "chore(release): vX.Y.Z" --body "..."
   ```

   The PR body should include the version-bump rationale and the same
   changelog list. Print the PR URL and tell the user: merge this (`/merge`
   or by hand), then run `/publish tag` (or just `/publish` again) from an
   updated `main` to cut and push the tag.

Do not create or push a tag in this phase.

---

### Tag phase

1. **Refuse and stop if**: not on `main`; `main` is not up to date with
   `origin/main`; the working tree is dirty; or HEAD already has a tag
   pointing at it (already released).

2. **Confirm with the user before doing anything irreversible.** State
   plainly: pushing tag `vX.Y.Z` triggers `.github/workflows/publish.yml`,
   which publishes `@kavo/core`, `@kavo/typeorm`, and `@kavo/nest` to the
   public npm registry — this cannot be meaningfully undone. Wait for an
   explicit go-ahead.

3. **Tag and push:**

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. **Watch the release workflow** and report the result:

   ```bash
   gh run watch --exit-status $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   ```

   If it fails, report the failing step's output — do not retry blindly;
   a failed OIDC trusted-publisher match or a stale npm CLI version are the
   most likely causes.

5. **Report**: the tag, the workflow run URL, and (once it finishes) the
   published package versions.
