---
description: Gate, push, and open a pull request for the current branch
argument-hint: "[--draft, or notes for the PR description]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Bash(gh:*), Read, Grep, Glob
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Commits on branch: !`git log main..HEAD --oneline`
- Remote: !`git remote -v | head -1 || echo "NO REMOTE"`

## Your task

Open a PR for this branch. Notes: **$ARGUMENTS**

1. **Refuse to ship if any of these hold** — say which one, and stop:
   - the branch is `main`;
   - there is no GitHub remote;
   - the working tree is dirty (commit with `/commit` first);
   - there are no commits on the branch.

2. **Run the gate for real:**

   ```bash
   pnpm check
   ```

   If build, `depcruise`, or the tests fail, **stop** and report the failure
   output. A red gate is never shipped, and never worked around.

3. **Confirm the branch was reviewed.** If `/review` has not run in this
   conversation, run it now and resolve anything blocking before continuing.

4. **Push** and set upstream:

   ```bash
   git push -u origin HEAD
   ```

5. **Open the PR** with `gh pr create`. Use `--draft` if the user asked for a
   draft or if anything non-blocking is still open. The description should say:

   - **What** changed and **why**, in a short paragraph — not a file list.
   - `Closes #<n>` for the issue, so the merge closes it automatically.
   - **Public API impact** — barrel changes, and whether they are breaking.
     Write "none" when there are none; do not omit the line.
   - **Testing** — what was added, and the verified `pnpm check` result.
   - **Review notes** — anything you want a reviewer to look at hardest, and any
     non-blocking findings deliberately left for later.

6. **Print the PR URL** and tell the user to run `/merge` once CI is green.

Do not merge here. `/ship` opens the PR; `/merge` closes the loop.
