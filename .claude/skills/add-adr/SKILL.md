---
name: add-adr
description: When and how to write a new ADR in packages/docs/adr/ — numbering, required sections, and how it must connect to code and the architecture docs. Use when a change makes a load-bearing decision (a seam, an invariant, a boundary rule) rather than just implementing one already on record.
---

# Writing an ADR

Kavo records one ADR per load-bearing decision (`packages/docs/adr/0001`…`0014`).
They are read before changing the behavior they govern (CLAUDE.md), so an ADR
is only worth writing when a future change could plausibly get the decision
wrong without it.

## Decide whether this change needs one

Write an ADR when the change:

- introduces a new seam or contract other code will be built against (a new
  resolver, a new precedence rule, a new boundary between packages);
- forecloses an alternative someone will naturally reach for later (e.g. "why
  isn't this just a second config mechanism?");
- changes something `.dependency-cruiser.cjs` or a schema enforces mechanically
  — the ADR is the "why" the enforcement doesn't say.

Don't write one for a normal feature addition that fits an existing pattern
(a new standard operation via the registry, a new DTO slot) — that's the
`add-operation` skill's territory, already covered by ADR-0006/0007. Don't
write one to narrate an implementation detail with no future alternative to
foreclose.

## Numbering and location

- File: `packages/docs/adr/00NN-kebab-title.md`, next sequential number —
  check the highest existing file first, never reuse or renumber.
- ADRs are **never superseded by editing in place**. If a later decision
  overturns one, the old ADR's `Status` becomes `superseded by ADR-00MM` and
  the new ADR explains the change; the history stays legible.

## Required shape

Follow the existing ADRs' structure (e.g. ADR-0013):

```markdown
# ADR-00NN — <decision, stated as the resolution, not the topic>

**Status:** accepted (Phase N, if applicable)

## Context

The tension or constraint that forces a choice — what two things are in
conflict, and why the obvious alternative doesn't work. Reference the
specific mechanism it collides with (a phase, another ADR, a boundary rule).

## Decision

The rule, stated normatively enough that a reviewer can check code against
it. Enumerate the specific cases if the rule has edges (see ADR-0013's
`restoreOne`/`purgeOne` split).

## Consequences (if non-obvious)

What this forecloses, and what it costs. Skip if the decision speaks for
itself.
```

## Wire it into the rest of the docs

An ADR that nothing points to is dead weight:

- Reference it from the relevant `packages/docs/architecture/NN-*.md` doc,
  the way doc 08 §2 and §4 would reference a config ADR.
- Reference it from the code that implements the decision, the way existing
  comments cite `ADR-0012` or `ADR-0006` — a future reader hitting the
  invariant should be one grep away from the reasoning.
- If it changes a normative rule in the top-level CLAUDE.md **Conventions**
  section, update that section too — CLAUDE.md is supposed to stay in sync,
  not drift into contradiction with the ADR it summarizes.

## Before you call it done

Run the `kavo-docs-auditor` review pass (or fold it into `/review`, which
runs it automatically for a branch touching engine/config/registry/public-API
behavior) — it specifically checks for new invariants introduced without a
governing ADR.
