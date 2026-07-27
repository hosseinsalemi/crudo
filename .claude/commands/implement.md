---
description: Plan an issue, get approval, implement it on a new branch, then commit and open a PR once the user approves the diff
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
   is no GitHub remote, stop and say so. If the working tree is dirty, stop and
   ask whether to commit (`/commit`) or stash first — never start new work on
   top of uncommitted changes. If the session's current directory is inside
   `.claude/worktrees/`, exit it first (`ExitWorktree` with `keep`) so the new
   branch is created and implemented in the main checkout — the one the
   user's editor has open — not in an isolated worktree they won't see.

2. **Read the issue in full**: `gh issue view <n> --json title,body,labels,comments`.

3. **Plan it.** Launch the `kavo-architect` agent with the issue number and its
   full text. It is read-only and returns a plan: goal, acceptance criteria,
   affected packages and files, design and the seam it uses, the invariants and
   ADRs in play, public-API impact, an ordered task list, a test plan, and risks.

4. **Present the plan for approval.** Show it in full. If the architect flagged
   the issue as too vague, or proposed splitting it, surface that prominently
   rather than burying it — that is a decision for the user, not for you. If
   the user asks for changes, revise the plan (re-running the architect if the
   change is substantial) and present it again.

   **Stop here and wait for explicit approval. Do not write any code.**

5. **Create the branch.** Follow the `conventions` skill to derive
   `<type>` from the issue's label and check out
   `<type>/<issue-number>-<short-slug>` off an up-to-date `main`.

6. **Implement it yourself**, task by task in the plan's order, folding in any
   extra instructions from `$ARGUMENTS`. You have the full conversation
   context; do not delegate this to a subagent, which would start cold and
   re-derive it.

7. **Write the tests alongside the code**, not after. Follow the `write-tests`
   skill: tests in `tests/`, never `src/`; assert exception **codes**, not just
   messages; cover the error and edge paths, and add a failing-first regression
   test for any bugfix.

8. **Format the code**:

   ```bash
   pnpm prettify
   ```

9. **Run the gate** and make it pass:

   ```bash
   pnpm check
   ```

   That is build + `depcruise` + the full suite. If it fails, fix it — do not
   report success over a red gate, and do not weaken a test to make it pass.

10. **Update the docs** if you changed behavior an ADR or a
    `packages/docs/architecture/` document governs. Silent divergence is a
    review finding.

11. **Leave the changes uncommitted** and report what changed, the real
    `pnpm check` result, and anything in the plan you did **not** do and why.
    Tell the user the diff is sitting uncommitted in their editor (VSCode) for
    review, and ask them to reply with explicit approval (e.g. "ok") once
    they've looked it over.

    **Stop here and wait.** Do not stage, commit, or push anything yet — the
    user reviews the live working tree in their editor, not a summary.

12. **On explicit approval**, and not before:

    a. **Commit** using the `commit` skill's own logic: analyze the changes,
       group them into cohesive logical commits (config/tooling separate from
       source, docs separate from implementation), stage each group precisely
       with explicit pathspecs (never `git add -A`), and commit with a
       Conventional Commits message per the `conventions` skill. Do not push
       here, do not amend, and do not add co-author trailers unless recent
       commits on this branch already use them.

    b. **Open the PR** using the `pr` skill's own logic: refuse if the branch
       is `main`, there's no remote, or there are no commits; re-run
       `pnpm check` for real and stop if it's red; `git push -u origin HEAD`;
       then `gh pr create` (or update the existing PR) with what/why, `Closes
       #<n>`, public-API impact, testing, and review notes.

    c. **Print the PR URL** and tell the user to run `/review` on it or
       `/merge` once CI and review are green.

If the user asks for changes instead of approving, revise the working tree
and return to step 11 — do not commit a diff that wasn't approved as shown.

If you hit something the plan got wrong, say so and propose the correction
before implementing around it.
