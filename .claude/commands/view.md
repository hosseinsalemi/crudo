---
description: View the details of a GitHub issue by number
argument-hint: <issue number>
allowed-tools: Bash(gh:*)
---

## Context

- Repo: !`gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "NO REMOTE"`

## Your task

Issue number: **$ARGUMENTS**

If the repo line says `NO REMOTE`, stop and say this repo has no GitHub
remote. If no issue number was given, stop and ask for one — do not guess
which issue is meant.

Run `gh issue view $ARGUMENTS` and show the result: title, state, labels, and
the full body (context, acceptance criteria, affected packages, constraints,
out of scope — whatever sections the issue has). Do not summarize or
truncate the body. If the issue doesn't exist, say so plainly.
