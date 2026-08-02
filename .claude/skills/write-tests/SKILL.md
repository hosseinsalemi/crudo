---
name: write-tests
description: How to write tests for the Kavo monorepo — file placement, Vitest/SWC setup, fixtures, and the cases every change must pin down. Use when adding or updating tests in packages/core, packages/orms/typeorm, or packages/frameworks/nest.
---

# Writing tests for Kavo

## Placement and setup

- Tests go in each package's `tests/` directory — **never in `src/`**, so they
  are not shipped in `dist/`. The layout is flat: `packages/core/tests/*.spec.ts`,
  with shared fixtures in `packages/core/tests/support/`.
- Vitest aliases `@kavo/*` to package `src/` (see `vitest.config.ts`), so tests
  import the package by name and exercise sources directly. **Never import from
  `dist/`.**
- The SWC vitest plugin is mandatory: TypeORM entities and Nest DI need
  decorator metadata that esbuild cannot emit. If a test loses metadata
  unexpectedly, suspect the transform before the logic.

```bash
pnpm test                                                    # whole monorepo
pnpm vitest run packages/core/tests/filter-parser.spec.ts    # one file
pnpm vitest run -t "coerces JavaScript number syntax"        # one test by name
```

## Reuse the fixtures

Check `packages/core/tests/support/` before building anything: there are
existing entity fixtures (`user-fixture.ts`, `blog-fixture.ts`,
`account-fixture.ts`) and shared query cases. A new ad-hoc entity in a spec file
is usually a fixture that already exists.

## Test through the real seams

Kavo is built from injected seams — handlers, serializer/deserializer, query
normalizer, pagination strategies, error handler. Prefer driving the **real
engine** with a test adapter over mocking the pipeline. A test that mocks the
thing it is testing passes when the implementation is wrong.

Assert **observable behavior**, not internals. Call counts, private fields and
the order of injected seams break on every refactor and catch no bugs.

## The cases a change must pin down

For each behavior you add or change, write the test that would fail if it
silently regressed:

- **Happy path** — the intended result, with the full shape asserted, not
  `toBeDefined()`.
- **Validation** — rejected input produces the right rejection, not a crash.
- **Error path** — assert the thrown `*Exception` type **and** its
  `KAVO_SNAKE_CASE` code. The code is a public contract; asserting only the
  message lets the code drift silently.
- **Edge cases** — empty results, `null` vs. absent, boundary pagination values,
  the field-path recursion cap (ADR-0008), unknown include paths,
  non-allowlisted filter fields, disabled operations.
- **Regression** — a bugfix without a test that fails against the old code is
  unfinished. Write that test first and watch it fail.

## Contracts that need wire-level assertions

These cross a boundary to a consumer, so assert the actual shape:

- query-string parsing and operator-token mapping (camelCase wire tokens →
  `SCREAMING_SNAKE` AST enum, exact-case matched)
- the response envelope: `items`, `limit`, `offset`, `total`, `meta`
- problem-details error output
- generated routes: method, path, and manual-method-wins suppression

## Before you call it done

Run `pnpm check` — build, `depcruise`, and the full suite. Report the real
result; if something fails, say so with the output.
