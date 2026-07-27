---
description: List open GitHub issues, grouped and annotated for picking what's next
argument-hint: "[filter, e.g. a label or 'closed']"
allowed-tools: Bash(gh:*)
---

## Context

- Repo: !`gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "NO REMOTE"`
- Issues: !`gh issue list --state open --limit 50 2>/dev/null || echo "unavailable"`

## Your task

Filter, if given: **$ARGUMENTS** (a label like `status:ready`, `area:core`, or
`closed` to list closed issues instead — re-run `gh issue list` with the
appropriate flag rather than filtering the context above by hand).

If the repo line says `NO REMOTE`, stop and say this repo has no GitHub remote.

Show the issues as a table: number, title, labels, status (`ready` /
`blocked` / no status label). Group `status:ready` issues first, then
`status:blocked`, then unlabeled-status issues last. Keep it terse — this is a
lookup, not a report.
