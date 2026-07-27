---
description: Run the pre-commit gate — format, build, typecheck, tests, and the reviewer fan-out — against uncommitted changes
argument-hint: "[area to focus on]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Read, Grep, Glob, Agent, Task
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Committed-on-branch diff: !`git diff main...HEAD --stat`
- Uncommitted diff (not yet run through `/commit`): !`git status --short`

## Your task

Verify this change before it gets committed. `/implement` does not commit, so
the work under verification is usually still sitting uncommitted in the
working tree — do not assume `git diff main...HEAD` alone tells you what
changed. Focus, if given: **$ARGUMENTS**

1. **Preflight.** If the branch is `main`, or both diffs above are empty, say
   so and stop — there is nothing to verify.

2. **Format the code**:

   ```bash
   pnpm prettify
   ```

   Leave any resulting changes uncommitted — `/commit` picks them up along
   with everything else. Do not commit here.

3. **Run the gate for real:**

   ```bash
   pnpm check
   ```

   That is build + typecheck + `depcruise` + the full test suite. If it fails,
   **stop** and report the failure output — do not proceed to review a change
   that doesn't build or pass its tests, and never weaken a test to make it
   pass.

4. **Run the three reviewers in parallel**, in a single message. They are
   read-only and deliberately non-overlapping:

   - `kavo-reviewer` — correctness, engine and registry design invariants,
     naming compliance.
   - `kavo-boundary-guard` — ADR-0005 core purity, deep imports, ORM/framework
     leakage, barrel and breaking-change audit.
   - `kavo-test-auditor` — coverage gaps, weak tests, misplaced test files.

5. **Consolidate.** Merge their findings into one ranked list and drop the
   duplicates. Do not just paste three reports.

   For each finding keep: the file and line, one sentence on the defect, the
   concrete failure scenario, and the fix. Split it into:

   - **Blocking** — must be fixed before this gets committed.
   - **Non-blocking** — worth doing, does not gate the commit.

6. **Verify before you report.** Agents sometimes report findings that do not
   hold up. Check the ones that would be expensive to act on against the actual
   code, and drop what you cannot confirm. A short list of real findings beats a
   long list of plausible ones.

7. **State the verdict plainly**: ready to commit (`/commit`), or blocked on N
   findings. If the change is clean, say so and list what was actually
   verified — including the `pnpm check` result.

Report only. Do not fix anything unless the user asks — then fix the blocking
findings and re-run `pnpm check`.
