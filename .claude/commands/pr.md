---
description: Gate, push, and create or update the pull request for the current branch
argument-hint: "[--draft, or notes for the PR description]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Bash(gh:*), Read, Grep, Glob
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Commits on branch: !`git log main..HEAD --oneline`
- Remote: !`git remote -v | head -1 || echo "NO REMOTE"`
- Existing PR for this branch: !`gh pr view --json number,url,isDraft 2>/dev/null || echo "NO PR"`

## Your task

Push this branch and create or update its PR. Notes: **$ARGUMENTS**

1. **Refuse to push if any of these hold** — say which one, and stop:
   - the branch is `main`;
   - there is no GitHub remote;
   - the working tree is dirty (commit with `/commit` first);
   - there are no commits on the branch.

2. **Run the gate for real:**

   ```bash
   pnpm check
   pnpm docs:links
   ```

   If build, typecheck, `depcruise`, or the tests fail, **stop** and report the
   failure output. A red gate is never pushed, and never worked around. The
   same goes for `docs:links` — it is a separate CI job, so `pnpm check`
   passing says nothing about it, and pushing without it means finding out from
   a red job instead of from a one-second local run.

3. **Push:**

   ```bash
   git push -u origin HEAD
   ```

4. **Create the PR, or update it if one already exists** (see the context
   above):
   - **No PR yet** — `gh pr create`. Use `--draft` if the user asked for a draft
     or if anything non-blocking is still open. The description should say:
     - **What** changed and **why**, in a short paragraph — not a file list.
     - `Closes #<n>` for the issue, so the merge closes it automatically.
     - **Public API impact** — barrel changes, and whether they are breaking.
       Write "none" when there are none; do not omit the line.
     - **Testing** — what was added, and the verified `pnpm check` result.
     - **Review notes** — anything you want a reviewer to look at hardest, and
       any non-blocking findings deliberately left for later.

   - **PR already exists** — the push above already updated it with the new
     commits. Only touch the description if `$ARGUMENTS` gives new notes or the
     existing body is now stale (e.g. the testing/review-notes sections no
     longer reflect the latest commits); update it with `gh pr edit <n> --body
"..."` in that case. Do not needlessly rewrite an accurate description.

5. **Print the PR URL** and tell the user to run `/review` on it or `/merge`
   once CI and review are green.

Do not merge here. `/pr` opens or updates the PR; `/merge` closes the loop.
