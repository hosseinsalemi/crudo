---
description: Review the current branch (uncommitted changes plus any prior commits) with the full reviewer fan-out
argument-hint: "[area to focus on]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Read, Grep, Glob, Agent, Task
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Committed-on-branch diff: !`git diff main...HEAD --stat`
- Uncommitted diff (not yet run through `/commit`): !`git status --short`

## Your task

Review this branch. `/implement` does not commit, so the work under review is
usually still sitting uncommitted in the working tree — do not assume
`git diff main...HEAD` alone tells you what changed. Focus, if given:
**$ARGUMENTS**

1. **Preflight.** If the branch is `main`, or both diffs above are empty, say
   so and stop — there is nothing to review.

2. **Format the code**:

   ```bash
   pnpm prettify
   ```

   Leave any resulting changes uncommitted — `/commit` picks them up along
   with everything else. Do not commit here.

3. **Run the three reviewers in parallel**, in a single message. They are
   read-only and deliberately non-overlapping:

   - `kavo-reviewer` — correctness, engine and registry design invariants,
     naming compliance. Also runs `pnpm check`.
   - `kavo-boundary-guard` — ADR-0005 core purity, deep imports, ORM/framework
     leakage, barrel and breaking-change audit.
   - `kavo-test-auditor` — coverage gaps, weak tests, misplaced test files.

4. **Consolidate.** Merge their findings into one ranked list and drop the
   duplicates. Do not just paste three reports.

   For each finding keep: the file and line, one sentence on the defect, the
   concrete failure scenario, and the fix. Split it into:

   - **Blocking** — must be fixed before the PR merges.
   - **Non-blocking** — worth doing, does not gate the merge.

5. **Verify before you report.** Agents sometimes report findings that do not
   hold up. Check the ones that would be expensive to act on against the actual
   code, and drop what you cannot confirm. A short list of real findings beats a
   long list of plausible ones.

6. **State the verdict plainly**: ready to commit (`/commit`), or blocked on N
   findings. If the change is clean, say so and list what was actually
   verified — including the `pnpm check` result.

Report only. Do not fix anything unless the user asks — then fix the blocking
findings and re-run `pnpm check`.
