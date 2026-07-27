---
description: Plan an issue, get approval, then implement it on a new branch — does not commit
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
   top of uncommitted changes.

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

11. **Do not commit.** Leave the changes in the working tree.

12. **Report** what changed, the real `pnpm check` result, and anything in the
    plan you did **not** do and why. Then tell the user to run `/verify` or `/pr`.

If you hit something the plan got wrong, say so and propose the correction
before implementing around it.
