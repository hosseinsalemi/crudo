---
description: Review a change — uncommitted local work, or a pushed PR — with the full reviewer fan-out
argument-hint: "[PR number — omit to auto-detect: uncommitted work, else the current branch's open PR]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(pnpm:*), Read, Grep, Glob, Agent, Task
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Committed-on-branch diff: !`git diff main...HEAD --stat`
- PR: !`gh pr view $ARGUMENTS --json number,title,state,isDraft,baseRefName,headRefName,url,mergeable 2>/dev/null || echo "NO PR"`

## Your task

Review **$ARGUMENTS**. This command covers two modes — pick one before doing
anything else:

- **Local mode**: reviews uncommitted work still sitting in the working tree
  (what `/implement` leaves behind), before it gets committed.
- **PR mode**: reviews a pushed, open pull request.

1. **Pick the mode:**
   - If `$ARGUMENTS` is a PR number, or no number was given but the context
     above shows an open PR for the current branch **and** the working tree is
     clean with nothing uncommitted beyond what that PR already contains, use
     **PR mode**.
   - Otherwise, if there is uncommitted work or a committed-but-unpushed diff
     on the current branch, use **Local mode**.
   - If neither holds — clean tree, no PR, nothing on the branch — say so and
     stop. There is nothing to review.

2. **Get the code in front of you:**
   - **Local mode**: the diff is already on disk. Don't assume
     `git diff main...HEAD` alone tells you what changed — uncommitted work
     doesn't show up there; use `git status --short` and the working tree
     directly.
   - **PR mode**: if the PR's `headRefName` is not the currently checked-out
     branch, run `gh pr checkout <n>` to fetch and switch to it. Do not
     force-push, rebase, or amend anything on it. Diff it against its base, not
     blindly against `main` — a PR can target another branch:

     ```bash
     git diff <baseRefName>...<headRefName> --stat
     ```

3. **Local mode only — format and gate:**

   ```bash
   pnpm prettify
   ```

   Leave any resulting changes uncommitted — `/commit` picks them up along
   with everything else. Do not commit here.

   ```bash
   pnpm check
   ```

   That is build + typecheck + `depcruise` + the full test suite. If it fails,
   **stop** and report the failure output — do not proceed to review a change
   that doesn't build or pass its tests, and never weaken a test to make it
   pass.

   (PR mode also gets `pnpm check` coverage, via `kavo-reviewer` below.)

4. **Run the reviewers in parallel**, in a single message. They are
   read-only and deliberately non-overlapping:
   - `kavo-reviewer` — correctness, engine and registry design invariants,
     package boundaries and public-API/barrel compliance, ADR/architecture-doc
     sync, and naming compliance. In PR mode, also runs `pnpm check`. Always
     include this one.
   - `kavo-test-auditor` — coverage gaps, weak tests, misplaced test files.
   - `kavo-security-auditor` — allowlist bypass, mass assignment,
     `exposeInternals` misuse, DTO/internal-field leakage.
   - `kavo-perf-auditor` — N+1 patterns, unbounded includes, pagination
     bypass, adapter query-builder inefficiency.

   Only include `kavo-security-auditor` / `kavo-perf-auditor` if the diff
   actually touches their area — e.g. skip `kavo-perf-auditor` for a change
   confined to error-handling code. When in doubt, include it; a clean report
   costs little.

5. **Consolidate.** Merge their findings into one ranked list and drop
   duplicates. Do not just paste three reports.

   For each finding keep: the file and line, one sentence on the defect, the
   concrete failure scenario, and the fix. Split it into:
   - **Blocking** — must be fixed before this gets committed (local mode) or
     merged (PR mode).
   - **Non-blocking** — worth doing, does not gate it.

6. **Verify before you report.** Agents sometimes report findings that do not
   hold up. Check the ones that would be expensive to act on against the actual
   code, and drop what you cannot confirm. A short list of real findings beats a
   long list of plausible ones.

7. **State the verdict plainly**:
   - **Local mode**: ready to commit (`/commit`), or blocked on N findings.
   - **PR mode**: ready to merge (`/merge`), or blocked on N findings.

   If the change is clean, say so and list what was actually verified —
   including the `pnpm check` result.

8. **PR mode only — offer, don't post.** If the user wants the findings left
   on the PR itself, ask first, then post with `gh pr comment <n> --body "..."`
   or `gh pr review <n> --request-changes --body "..."` — posting to a shared
   PR needs explicit go-ahead, same as any other public comment.

Report only by default. Do not fix anything unless the user asks — then fix
the blocking findings and re-run `pnpm check`.
