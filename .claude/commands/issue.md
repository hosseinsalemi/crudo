---
description: Turn a rough idea into a well-formed, plannable GitHub issue
argument-hint: <rough description of the work>
allowed-tools: Bash(gh:*), Bash(git:*), Read, Grep, Glob
---

Create a GitHub issue for: **$ARGUMENTS**

## Context

- Repo: !`gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "NO REMOTE"`
- Existing labels: !`gh label list --limit 40 2>/dev/null || echo "unavailable"`
- Open issues: !`gh issue list --state open --limit 20 2>/dev/null || echo "unavailable"`

## Your task

If the repo line above says `NO REMOTE`, stop and tell the user this repo has no
GitHub remote yet — the issue workflow needs one. Do not create a repository
yourself; ask them to run `gh repo create` and say whether it should be public
or private.

1. **Check for duplicates** in the open issues above. If this overlaps an
   existing one, say so and ask whether to extend that issue instead of opening
   a new one.

2. **Ground it in the codebase.** Read enough to name the packages and files
   that would actually change. An issue that cannot name its blast radius is not
   ready to plan against.

3. **Write the issue.** Keep it short and concrete — this gets read once by a
   planner:

   - **Title** — imperative, specific (`Add cursor pagination strategy`, not
     `Pagination improvements`).
   - **Context** — why this is worth doing, in two or three sentences.
   - **Acceptance criteria** — a checklist of what must be true when it is done.
     These must be verifiable, not aspirational.
   - **Affected packages** — `@kavo/core`, `@kavo/typeorm`, `@kavo/nest`,
     docs, or a combination.
   - **Constraints** — the invariants that must survive: ADR-0005 core purity,
     registry-driven operations (ADR-0006), the explicit barrel (ADR-0010),
     decoration-time routes (ADR-0012), and the naming conventions in
     `CLAUDE.md`. Cite the ADRs that actually apply; skip the ones that do not.
   - **Out of scope** — what this issue deliberately does not cover.

4. **Label it.** Use the existing labels where they fit. The scheme is
   `type:feat|fix|chore|test|docs`, `area:core|typeorm|nest|docs`, and
   `status:ready` once it is plannable. Create a missing label with
   `gh label create <name>` only if it fits that scheme.

5. **Show it before creating anything.** Print the full drafted issue —
   title, labels, and body exactly as they would be submitted — and stop.
   Ask the user to confirm, and let them request edits. Do not run
   `gh issue create` or `gh label create` until they explicitly confirm the
   shown draft. If they ask for changes, revise and show the updated draft
   again before asking for confirmation a second time.

6. **Create it** with `gh issue create` only after confirmation, then print
   the issue number and URL.

Do not write any code. This command produces an issue and nothing else.
