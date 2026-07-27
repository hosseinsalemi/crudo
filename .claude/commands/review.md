---
description: Review an open pull request with the full reviewer fan-out
argument-hint: "[PR number — omit to use the current branch's PR]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(pnpm:*), Read, Grep, Glob, Agent, Task
---

## Context

- PR: !`gh pr view $ARGUMENTS --json number,title,state,isDraft,baseRefName,headRefName,url,mergeable 2>/dev/null || echo "NO PR"`
- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`

## Your task

Review PR **$ARGUMENTS** (or the current branch's PR if no number is given).
This reviews a pushed, open pull request — for uncommitted local work, use
`/verify` instead.

1. **Preflight.** If the context above says `NO PR`, stop and say so — there is
   nothing to review. If the working tree is dirty, stop and ask the user to
   commit or stash before you check out anything.

2. **Get the PR's code onto disk.** If the PR's `headRefName` is not the
   currently checked-out branch, run `gh pr checkout <n>` to fetch and switch to
   it. Do not force-push, rebase, or amend anything on it.

3. **Diff it against its base**, not blindly against `main` — a PR can target
   another branch:

   ```bash
   git diff <baseRefName>...<headRefName> --stat
   ```

4. **Run the reviewers in parallel**, in a single message. They are
   read-only and deliberately non-overlapping:

   - `kavo-reviewer` — correctness, engine and registry design invariants,
     naming compliance. Also runs `pnpm check`.
   - `kavo-boundary-guard` — ADR-0005 core purity, deep imports, ORM/framework
     leakage, barrel and breaking-change audit.
   - `kavo-test-auditor` — coverage gaps, weak tests, misplaced test files.
   - `kavo-security-auditor` — allowlist bypass, mass assignment,
     `exposeInternals` misuse, DTO/internal-field leakage.
   - `kavo-docs-auditor` — ADR/architecture-doc drift, undocumented public API,
     glossary gaps.
   - `kavo-perf-auditor` — N+1 patterns, unbounded includes, pagination
     bypass, adapter query-builder inefficiency.

   Only include an auditor if the diff actually touches its area — e.g. skip
   `kavo-perf-auditor` for a change confined to error-handling code. When in
   doubt, include it; a clean report costs little.

5. **Consolidate.** Merge their findings into one ranked list and drop
   duplicates. Do not just paste three reports.

   For each finding keep: the file and line, one sentence on the defect, the
   concrete failure scenario, and the fix. Split it into:

   - **Blocking** — must be fixed before this PR merges.
   - **Non-blocking** — worth doing, does not gate the merge.

6. **Verify before you report.** Agents sometimes report findings that do not
   hold up. Check the ones that would be expensive to act on against the actual
   code, and drop what you cannot confirm. A short list of real findings beats a
   long list of plausible ones.

7. **State the verdict plainly**: ready to merge (`/merge`), or blocked on N
   findings. If the PR is clean, say so and list what was actually verified —
   including the `pnpm check` result.

8. **Offer, don't post.** If the user wants the findings left on the PR itself,
   ask first, then post with `gh pr comment <n> --body "..."` or
   `gh pr review <n> --request-changes --body "..."` — posting to a shared PR
   needs explicit go-ahead, same as any other public comment.

Report only by default. Do not fix anything unless the user asks.
