---
description: Implement an issue directly on a new branch, then commit and open a PR once the user approves the diff
argument-hint: "<issue number> [extra instructions or corrections]"
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pnpm:*), Read, Edit, Write, Grep, Glob, Agent, Task, Skill
---

## Context

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Recent commits: !`git log --oneline -5`

## Your task

Arguments: **$ARGUMENTS** — the first token is the issue number; anything
after it is extra instructions or corrections to fold in during implementation.

1. **Preflight.** If no issue number was given, stop and ask for one. If there
   is no GitHub remote, stop and say so.

2. **Read the issue in full**: `gh issue view <n> --json title,body,labels,comments`.
   Restate its goal and acceptance criteria to yourself so the implementation
   is judged against them, not against a guess. If the issue is too vague to
   implement — missing acceptance criteria, an ambiguous design choice with no
   default the codebase implies — stop and ask rather than guessing; do not
   silently narrow the scope.

3. **Locate the seam before writing code.** Kavo is built out of swappable
   seams (`packages/core/src/engine/kavo-engine.ts`'s Template Method:
   operation resolution → config resolution → DTO resolution →
   deserialization → query resolution → handler execution → response mapping
   → serialization). Most changes are "add or modify a seam", not "add a
   branch" — find the existing seam before proposing a new mechanism. Check
   the invariants and ADRs your change touches (registry-driven operations,
   ADR-0006; decoration-time routes, ADR-0012; the explicit named barrel,
   ADR-0010; the composition root freezing after `createCrud`) and read the
   governing ADR in `docs/internals/adr/` before changing behavior it covers.
   Follow the naming conventions in `CLAUDE.md` — they are normative.

4. **Create the branch, in an isolated worktree.** Follow the `conventions`
   skill to derive `<type>` from the issue's label. Call `EnterWorktree` with
   `name: "<issue-number>-<short-slug>"` to create a fresh worktree — branched
   off up-to-date `main` — and switch the session into it, then rename the
   branch to match the convention: `git branch -m <type>/<issue-number>-<short-slug>`.
   Implementing in a worktree keeps this work off the branch the user's editor
   has open.

5. **Implement it yourself**, directly, folding in any extra instructions from
   `$ARGUMENTS`. You have the full conversation context; do not delegate this
   to a subagent, which would start cold and re-derive it. If mid-implementation
   you find the issue's premise doesn't hold — a proposed approach conflicts
   with an invariant, or the issue should be split — stop and say so rather
   than plowing ahead.

6. **Write the tests alongside the code**, not after. Follow the `write-tests`
   skill: tests in `tests/`, never `src/`; assert exception **codes**, not just
   messages; cover the error and edge paths, and add a failing-first regression
   test for any bugfix.

7. **Format the code**:

   ```bash
   pnpm prettify
   ```

8. **Run the gate** and make it pass:

   ```bash
   pnpm check
   pnpm docs:links
   ```

   That is build + typecheck + `depcruise` + the full suite. If it fails, fix
   it — do not report success over a red gate, and do not weaken a test to
   make it pass.

   `docs:links` is a separate CI job rather than part of `pnpm check`, so run
   it explicitly: it takes under a second, needs no toolchain, and catches a
   reference to a doc that was renamed or moved.

9. **Update the docs** if you changed behavior an ADR or a
   `docs/internals/architecture/` document governs. Silent divergence is a
   review finding.

10. **Leave the changes uncommitted** and report what changed, against the
    issue's acceptance criteria, the real `pnpm check` result, and anything
    from the issue you did **not** do and why. Tell the user the diff is
    sitting uncommitted in the worktree (give its path) for review, and ask
    them to reply with explicit approval (e.g. "ok") once they've looked it
    over.

    **Stop here and wait.** Do not stage, commit, or push anything yet — the
    user reviews the live working tree in the worktree, not a summary.

11. **On explicit approval**, and not before:

    a. **Commit** — invoke the `commit` command and follow it. Do not
    reimplement its rules here; it owns them, and a second copy in this file
    is a copy that drifts out of sync with the first.

    b. **Open the PR** — invoke the `pr` command and follow it, passing the
    issue number so the body can close it.

    c. **Print the PR URL** and tell the user to run `/review` on it or
    `/merge` once CI and review are green.

If the user asks for changes instead of approving, revise the working tree
and return to step 10 — do not commit a diff that wasn't approved as shown.

If you hit something the issue got wrong, say so and propose the correction
before implementing around it.
