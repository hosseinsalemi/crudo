---
description: Verify CI, merge the PR, delete the branch, and return to an updated main
argument-hint: "[PR number — omit to use the current branch's PR]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(pnpm:*), Read
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- PR: !`gh pr view $ARGUMENTS --json number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,url 2>/dev/null || echo "NO PR"`
- Checks: !`gh pr checks $ARGUMENTS 2>/dev/null || echo "no checks reported"`

## Your task

Close the loop on this PR. Argument: **$ARGUMENTS**

1. **Refuse to merge if any of these hold.** Report which one and stop:
   - there is no matching PR;
   - the PR is still a **draft**;
   - any required check is **failing or still running** — wait for it, do not
     merge past it;
   - `mergeable` is false, or there are conflicts with `main`;

   If the only problem is that checks are still running, say so and offer to
   wait rather than merging blind.

2. **Say what you are about to merge** — PR number, title, commit count, and the
   issue it closes — and get the user's go-ahead before the merge itself. This
   is the irreversible step.

3. **Merge with squash**, keeping history linear and one commit per issue:

   ```bash
   gh pr merge <n> --squash --delete-branch
   ```

   Write the squash commit subject as a Conventional Commit matching this repo's
   style (`feat(core): …`), with the body summarizing the change and referencing
   the issue.

4. **Return to a clean main:**

   ```bash
   git checkout main && git pull --ff-only
   git remote prune origin
   ```

   Confirm the local branch is gone; delete it with `git branch -d <branch>` if
   it survived the remote deletion.

5. **Verify main is green** after the merge:

   ```bash
   pnpm check
   ```

   If `main` is broken by the merge, say so immediately and treat fixing it as
   the next task — do not move on to another issue.

6. **Confirm the issue closed.** `Closes #<n>` in the PR body should have done
   it; if the issue is still open, close it with a comment pointing at the PR.
