---
description: Pick the next ready issue, plan it with the architect, and open a branch on approval
argument-hint: "[issue number — omit to pick the highest-priority ready issue]"
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pnpm:*), Read, Grep, Glob, Agent, Task
---

## Context

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Ready issues: !`gh issue list --state open --label "status:ready" --limit 20 2>/dev/null || gh issue list --state open --limit 20 2>/dev/null || echo "NO REMOTE"`

## Your task

Argument (may be empty): **$ARGUMENTS**

1. **Preflight.** If there is no GitHub remote, stop and say so. If the working
   tree is dirty, stop and ask whether to commit (`/commit`) or stash first —
   never start new work on top of uncommitted changes.

2. **Select the issue.** If an issue number was given, use it. Otherwise pick
   the highest-priority `status:ready` issue and **say which one you picked and
   why** before going further. Read it in full:
   `gh issue view <n> --json title,body,labels,comments`.

3. **Plan it.** Launch the `crudo-architect` agent with the issue number and its
   full text. It is read-only and returns a plan: goal, acceptance criteria,
   affected packages and files, design and the seam it uses, the invariants and
   ADRs in play, public-API impact, an ordered task list, a test plan, and risks.

4. **Present the plan for approval.** Show it in full. If the architect flagged
   the issue as too vague, or proposed splitting it, surface that prominently
   rather than burying it — that is a decision for the user, not for you.

   **Stop here and wait for explicit approval. Do not write any code.**

5. **On approval**, create the branch off an up-to-date `main` and confirm:

   ```bash
   git checkout main && git pull --ff-only
   git checkout -b <type>/<issue-number>-<short-slug>
   ```

   where `<type>` matches the issue's `type:` label (`feat`, `fix`, `chore`,
   `test`, `docs`). Then tell the user to run `/implement`.

Keep the approved plan in the conversation — `/implement` works from it.
