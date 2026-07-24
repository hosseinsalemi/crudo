# Crudo Refactoring Plan

## Starting point: an audit, not an assumption

Before writing this plan, the codebase was audited end-to-end against the
rules Crudo already holds itself to (CLAUDE.md's comment policy, the
Naming Conventions section of [`crudo-phases-v6.md`](crudo-phases-v6.md),
and the package-boundary rules in `.dependency-cruiser.cjs`). The honest
result: **the codebase is clean.** There is no dead weight of
restating comments, no duplicated logic across packages, no god-functions,
and no naming violations. This is expected — Crudo is built phase-by-phase
against an authoritative spec with an ADR for every load-bearing decision,
which is precisely the discipline that prevents the drift a refactor
normally exists to undo.

So this plan is **not** a rewrite. It is a short list of genuine, narrow
findings, plus a few phases that pull forward and formalize work the spec
already schedules (Phase 16's naming audit) rather than inventing busywork
to justify a "refactor." Each phase is small and independently shippable
behind `pnpm check`. If a phase turns up nothing on closer inspection, the
right outcome is to close it with a one-line note, not to manufacture a
change.

**Ground rules for every phase below** (from CLAUDE.md, carried forward
here so they don't need repeating per phase):

- No behavior changes without a failing test first. This is refactoring —
  the test suite is the contract that proves nothing moved.
- No new abstractions unless a phase's own audit step finds ≥2 real call
  sites that need it. Three similar lines beat a premature interface.
- Comments stay WHY-only. Don't add comments while touching a file unless
  the change introduces a non-obvious constraint.
- `pnpm check` (build + depcruise + test) is the exit gate for every phase.

---

## Phase 1 — Close the two dead-surface findings

**Why:** the only two genuine loose ends the audit found. Both are small
enough to resolve outright rather than schedule further investigation.

1. `packages/core/src/query/filter-builder.ts` — `FilterBuilder` is
   exported from the core barrel and its doc comment claims
   `@crudo/typeorm` targets it, but `FilterTranslator`
   (`packages/orms/typeorm/src/filter-translator.ts:20`) has an
   incompatible shape (`apply(filter)` returns `void`, not
   `apply(filter, target, context): Target`) and doesn't implement it.
   Nothing in the tree implements or consumes `FilterBuilder`.
   - Decide: either make `FilterTranslator` actually implement
     `FilterBuilder` (adjust the interface to match the real shape), or
     delete the interface and its barrel export if it was a speculative
     seam that never got wired up. Check `packages/docs/architecture/`
     for any doc that references it before deleting.
2. `packages/core/src/persistence/transaction-manager.ts` —
   `TransactionManager` / `TransactionOptions` / `TransactionPropagation`
   are exported but unimplemented in `@crudo/typeorm` or `@crudo/nest`;
   `context.transaction` is threaded as an opaque handle instead. This
   looks like an intentional forward-declared seam for deferred bulk
   `atomic` work, not a mistake.
   - Don't delete it. Add a short `@remarks` on the exported types (or a
     line in the relevant ADR, if one already discusses bulk atomicity)
     stating it's an intentionally unimplemented seam and pointing at the
     phase/issue that will bind it. The goal is that the next reader
     doesn't have to rediscover "is this dead or pending?" themselves.

**Exit:** `pnpm check` green; either `FilterBuilder` has a real
implementer or is gone; `TransactionManager`'s status is documented at
its definition site.

---

## Phase 2 — Pull Phase 16's naming-consistency audit forward

**Why:** `crudo-phases-v6.md` Phase 16 already schedules "a
naming-consistency audit of the whole public surface against the Naming
Conventions section — the last cheap moment to rename anything." The
audit here found zero violations, but it was scoped to the five hottest
files, not the full public surface (all barrel exports across all three
packages, every config key, every operation id). Running the full-surface
version now — before Phase 16 adds the DX API surface on top — is cheaper
than running it after.

1. Walk `packages/core/src/index.ts`, `packages/orms/typeorm/src/index.ts`
   (if present), and `packages/frameworks/nest/src/index.ts` export lists
   against every bullet in `crudo-phases-v6.md`'s "Naming Conventions
   (normative)" section: DTO slot names, `<Verb><Entity>Dto` /
   `<Entity><Slot>Dto` casing, operation `<verb>One`/`<verb>Many` naming,
   `CRUDO_SNAKE_CASE` exception codes, positively-phrased boolean config
   keys, no `I`-prefixed interfaces, `create*` factory naming.
2. Record findings (expected: none or near-none, per the audit) directly
   in this file's changelog section, or close the phase with a note if
   clean.

**Exit:** a documented pass/fail against every normative naming rule, not
just the subset already spot-checked.

---

## Phase 3 — Formalize the design-pattern catalog

**Why:** the architecture already uses several patterns deliberately
(Template Method in `CrudEngine.execute`, Strategy for pagination/handlers/
serializer/deserializer, Registry for operations, Composition Root in
`createCrudo`/`createCrud`, Adapter for `RepositoryAdapter`). None of this
needs to change — but it's currently implicit, spread across ADRs and
architecture docs rather than named in one place. Making it explicit is
what turns "good structure" into something reviewers and future
contributors can verify against, instead of having to re-derive it from
the code each time (which is exactly the situation this audit was just
in).

1. Add a short "Design Patterns" section to `packages/docs/architecture/`
   (or extend an existing overview doc) that names each pattern in use,
   the file where it's implemented, and the ADR that motivated it if one
   exists. No code changes — this phase is documentation only.
2. While doing this pass, flag (don't fix) any spot where a pattern is
   used inconsistently with itself — e.g. if pagination strategies and
   query normalizer strategies are structured differently for no reason.
   If Phase 3's audit finds a real inconsistency, split it into its own
   Phase 3a; don't fix it inline in a docs-only phase.

**Exit:** one doc section naming every deliberate pattern in the codebase
and where to find it.

---

## Phase 4 — `crud-engine.ts` comment consolidation (trivial)

**Why:** the only borderline comment finding in the audit.
`packages/core/src/engine/crud-engine.ts:91-124` numbers each pipeline
stage inline (`// 1. Operation resolution — ...`) in a way that partially
restates the class-level doc comment describing the same pipeline three
lines above. Not a violation of the WHY-only rule (each inline comment
does carry a little rationale beyond the stage name), but it's borderline
duplicate information in two places.

1. Read both comment blocks side by side. If the inline numbered comments
   add nothing beyond what the class doc already says, collapse them to
   one line each (stage name only, no restated rationale) or remove them
   and let the class doc be the single source of truth for the pipeline
   shape.
2. If they do carry distinct per-stage rationale not present in the class
   doc, leave them — don't consolidate for the sake of a smaller diff.

**Exit:** the pipeline is documented once, not twice, without losing any
WHY that isn't stated elsewhere.

---

## Phase 5 — Test-suite consistency pass

**Why:** the audit found test organization reasonable with no notable
duplication, but it only spot-checked `packages/core/tests/support/` and
the typeorm suite. A full pass confirms that stays true as the suite has
grown to 166+ tests across three packages, and catches any fixture
drift before it compounds.

1. Compare fixture conventions across `packages/core/tests/support/`,
   `packages/orms/typeorm/tests/`, and `packages/frameworks/nest/tests/`
   — naming, setup/teardown style, how entities are declared per spec.
2. Where two packages solve the same fixture problem differently for no
   reason (not because the layer genuinely needs something different),
   note it. Only extract a shared helper if the duplication is real and
   mechanical, not just "similar-looking."

**Exit:** either confirmation that test conventions are consistent, or a
short list of concrete fixture-drift spots with a call on whether each is
justified by layer differences.

---

## Phase 6 — Dependency-cruiser rule review

**Why:** `.dependency-cruiser.cjs` is what makes the hub-and-spoke
boundary real rather than aspirational. It hasn't been reviewed since
before Milestone C's relation/include work landed, which is exactly the
kind of feature (cross-entity views, Phase 15) that tends to tempt a
shortcut import. Confirming the rules still cover every current import
edge is cheap insurance, not a redesign.

1. Enumerate every cross-package import in the current tree (`core` →
   nothing; `typeorm`/`nest` → `@crudo/core` barrel only) and confirm
   `.dependency-cruiser.cjs` actually forbids every illegal edge it's
   supposed to (deep imports past the barrel, adapter↔framework imports).
2. If a rule is missing, add it with a comment citing which ADR it
   enforces. If all rules already cover the current edges, close the
   phase with that confirmation — no changes needed.

**Exit:** `pnpm depcruise` rule set verified to match the architecture
doc, not just assumed to.

---

## Phase 7 — Architecture doc sync check

**Why:** `packages/docs/architecture/` is described in CLAUDE.md as
mirroring the packages. Phase 15's relation/include work and its ADR
(0014) landed recently (per the last five commits); this phase confirms
the architecture docs actually reflect that, rather than assuming a doc
update happened alongside the code.

1. Diff each `packages/docs/architecture/*.md` file against the current
   shape of the package it describes. Flag anything stale.
2. Fix only factual drift (a renamed type, a moved file, a described
   behavior that changed). Don't rewrite doc prose style while in there.

**Exit:** every architecture doc file matches current code; any drift
found is listed and fixed or explicitly deferred with a reason.

---

## Phase 8 — Final gate

**Why:** close the loop; confirm the sum of Phases 1–7 didn't regress
anything, and that "refactor" here stayed true to its word — no behavior
changed, only dead surface removed/documented and drift corrected.

1. `pnpm check` (build + depcruise + test) clean.
2. Diff review: every changed file should map to a specific phase above.
   If a file changed for a reason not traceable to one of the phases,
   that's scope creep — back it out or fold it into a phase explicitly.
3. Update this file's changelog section (below) with what each phase
   actually found and did, since several phases above may close as
   "audited, no change needed" rather than producing a diff.

---

## Changelog

_(Fill in as each phase completes — actual findings, not planned findings.)_

- Phase 1:
- Phase 2:
- Phase 3:
- Phase 4:
- Phase 5:
- Phase 6:
- Phase 7:
- Phase 8:
