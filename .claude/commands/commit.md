---
description: Split working changes into multiple logical git commits
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git reset:*), Bash(git restore:*), Bash(git commit:*), Bash(git rev-parse:*)
---

You are creating one or more well-scoped git commits from the current working changes.

## Context

- Current status: !`git status --short`
- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Staged diff stat: !`git diff --cached --stat`
- Unstaged diff stat: !`git diff --stat`
- Recent commits (for style): !`git log --oneline -10`

## Your task

1. **Analyze** all changed files (both staged and unstaged). Read diffs as needed with `git diff` / `git diff --cached` to understand what each change does.

2. **Group** the changes into cohesive, logical commits. Group by intent, not by folder. Good boundaries:
   - One feature / bugfix / refactor per commit
   - Config & tooling separate from source code
   - Docs separate from implementation (unless trivially coupled)
   - Never mix unrelated concerns in one commit

3. **Stage precisely** for each group using explicit pathspecs: `git reset` first to clear the index, then `git add <specific files>` for the group. Do NOT use `git add -A` / `git add .`. Verify with `git status --short` before committing.

4. **Commit** each group with a Conventional Commits message — see the `conventions` skill for the type vocabulary and format.

5. Repeat until the working tree is clean (or only intentionally-excluded files remain).

## Rules

- Order commits so the history is sensible (e.g. tooling/config before code that depends on it).
- Do NOT push. Do NOT amend existing commits. Only create new commits.
- Do NOT add co-author trailers unless the repo's recent commits already use them.
- If a single file contains unrelated changes, use `git add -p` style patch staging only if truly necessary; otherwise keep the file whole in the most-fitting commit.
- After finishing, print a summary: the list of commits created (hash + subject) and confirm `git status` is clean.

$ARGUMENTS
