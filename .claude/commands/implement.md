---
description: Implement the approved plan on the current branch, with tests, and commit it
argument-hint: "[extra instructions or corrections to the plan]"
allowed-tools: Bash(git:*), Bash(pnpm:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, Skill
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Working tree: !`git status --short`
- Recent commits: !`git log --oneline -5`

## Your task

Implement the plan approved earlier in this conversation. Additional
instructions: **$ARGUMENTS**

1. **Preflight.** If you are on `main`, stop — work belongs on a branch, run
   `/next` first. If there is no approved plan in this conversation, stop and
   ask for one rather than inventing scope.

2. **Implement it yourself, task by task**, in the plan's order. You have the
   full conversation context; do not delegate this to a subagent, which would
   start cold and re-derive it. Consult the `add-operation` skill if the change
   adds, overrides, or disables an operation.

   Hold the line on the invariants while you work:
   - `@kavo/core` imports nothing (ADR-0005) — no TypeORM, no Nest, not even
     type-only.
   - Adapters and bindings import the `@kavo/core` **barrel only**, never deep
     paths. The TypeORM adapter and the Nest binding never import each other.
   - Operations come from the registry (ADR-0006). No per-verb special-casing in
     the engine or the route generator.
   - `packages/core/src/index.ts` is an explicit named list (ADR-0010) — add
     exports deliberately, never `export *`.
   - Naming is normative — see the Conventions section of `CLAUDE.md`.

3. **Write the tests alongside the code**, not after. Follow the `write-tests`
   skill: tests in `tests/`, never `src/`; assert exception **codes**, not just
   messages; cover the error and edge paths, and add a failing-first regression
   test for any bugfix.

4. **Format the code**:

   ```bash
   pnpm prettify
   ```

5. **Run the gate** and make it pass:

   ```bash
   pnpm check
   ```

   That is build + `depcruise` + the full suite. If it fails, fix it — do not
   report success over a red gate, and do not weaken a test to make it pass.

6. **Update the docs** if you changed behavior an ADR or a
   `packages/docs/architecture/` document governs. Silent divergence is a
   review finding.

7. **Commit** with a Conventional Commits message matching this repo's style
   (`feat(core):`, `fix(typeorm):`, `test(nest):`). Reference the issue in the
   body (`Refs #<n>`). Use `/commit` if the work splits cleanly into several
   commits.

8. **Report** what changed, the real `pnpm check` result, and anything in the
   plan you did **not** do and why. Then tell the user to run `/review`.

If you hit something the plan got wrong, say so and propose the correction
before implementing around it.
