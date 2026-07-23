# ADR-0008 — `FieldPath` recursion cap (default 3, max 5)

**Status:** accepted (Phase 3)

## Context

`FieldPath<TEntity>` expands entity shapes into a template-literal union
of dot-paths. The union grows combinatorially with depth; on entities with
many mutually-referential relations an uncapped expansion can slow type
checking dramatically or hit compiler limits ("type instantiation is
excessively deep").

## Decision

Depth is capped by a tuple-decrement counter: default 3, hard maximum 5
(`FieldPathDepth`). `any`/`unknown`/index-signature shapes degrade to
`string` rather than erroring.

## Consequences

- Compile-time spell-checking for the paths people actually write
  (`posts.comments.text`); deeper paths need an explicit
  `FieldPath<T, 4|5>` opt-in.
- Depth caps in the *type* system are independent of the *runtime* limits
  (`maxIncludeDepth`, allowlists) — the runtime remains the security gate.
- The degrade-to-`string` rule means untyped entities lose checking
  silently; documented, and acceptable against the alternative of breaking
  them.
