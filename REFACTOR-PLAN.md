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

- Phase 1: Both findings confirmed by audit and closed. (1) `FilterBuilder`
  had no implementer or consumer anywhere in the tree, but it is a **required
  Phase 3 contract** in `crudo-phases-v6.md` (lines 196, 341), so deleting it
  would have been a spec deviation. Instead adjusted the interface to the real
  shape — dropped the unused `Target`/`CrudContext` parameters, leaving
  `apply(filter): void` — and made `FilterTranslator` (`@crudo/typeorm`)
  declare `implements FilterBuilder<Entity>`. Type-only change; the doc comment
  now records WHY the target is constructor-bound (stateful parameter naming
  and join aliases). Corrected `packages/orms/typeorm/README.md`, which claimed
  the adapter implements `TransactionManager`. (2) `TransactionManager` /
  `TransactionOptions` / `TransactionPropagation` are unimplemented and
  unreferenced; kept, with an `@remarks` at the definition site explaining the
  status. Verified against the spec: v6 has **no** transaction phase — the only
  binder is bulk `atomic` mode's adapter-level `runInTransaction` hook (Phase
  9/10 "Transactions, scoped down"; Phase 14 makes bulk optional and this build
  dropped it). `TransactionContext` is live and was left alone. No ADR discusses
  transactions beyond ADR-0001's contract inventory, so no ADR was touched.
  Stale-doc note deferred to Phase 7: `architecture/01-system-architecture.md:83`
  and `architecture/03-core-contracts-and-type-system.md:114` still list
  `TransactionManager` as owned/implemented by `@crudo/typeorm`.
- Phase 2: Full-surface naming audit against every bullet of
  `crudo-phases-v6.md`'s "Naming Conventions (normative)" section (lines 21–56,
  re-read rather than recalled). **Result: zero violations — no renames made.**
  Surfaces walked: all three barrels (`packages/core/src/index.ts` — 60+ named
  exports, `packages/orms/typeorm/src/index.ts`, `packages/frameworks/nest/src/index.ts`),
  plus the non-barrel public surface (every config key, every operation id,
  every error code, the filter wire-token table, DTO class names in
  `packages/examples/src`). Per rule:
  - **Packages** — `@crudo/{core,typeorm,nest,examples}`, all lowercase. PASS.
  - **DTO slots** — `DtoSlot` (`dto/dto.ts:16`) is exactly
    `create|update|patch|query|item|list`; `OperationDtoMap` keys match; no
    seventh slot added by restore or custom operations. PASS.
  - **DTO classes** — examples define `CreateCatDto`/`UpdateCatDto` (verb-first
    request bodies) and `CatItemDto`/`CatListDto` (entity-first response
    shapes); same in the dog/owner modules and the nest/core test fixtures. PASS.
  - **`Dto` suffix rule** — every wire-crossing shape carries it
    (`ListResultDto`, `ListMetaDto`, `BulkResultDto`, `BulkItemFailureDto`,
    `ProblemDetailsDto`, `QueryIssueDto`, `BulkItemIssueDto`); no behavioral
    contract does (`DtoResolver`, `OperationDtoMap`, `CrudService`,
    `RepositoryAdapter`, `OperationRegistry` — `Dto` appears only as a prefix or
    mid-name, never a suffix). `QueryContext`, `IncludeRequest` and `Pagination`
    are query-model types, not wire shapes, and are named as the spec's Phase 3
    contract list requires. PASS.
  - **Operations** — `StandardOperationId` (`operations/operation.ts`) is 13 ids,
    every one camelCase with explicit cardinality; `STANDARD_OPERATIONS`,
    `CrudService`/`DefaultCrudService` methods, and `STANDARD_ROUTES` in the Nest
    decorator all use the identical id set, so config keys and method names can't
    drift apart. "Bulk" appears only as feature term (`bulk` settings key,
    `BulkResultDto`, `BulkSettings`, `BulkMode`, `BulkOperationException`) —
    grep confirms zero `bulk`-prefixed methods. PASS.
  - **Filter operators** — `FilterOperator` is 13 SCREAMING_SNAKE members;
    `WIRE_OPERATORS` (`query/default-filter-parser.ts:15`) maps 13 camelCase
    tokens onto them, matching Phase 5's table exactly (`notIn`, `isNull`,
    `isNotNull` included). PASS.
  - **Envelope fields** — `ListResultDto` is `items`/`limit`/`offset`/`total`/`meta`,
    mirroring the wire pagination params. PASS.
  - **Exceptions** — 11 `*Exception` classes, each with a `CRUDO_SNAKE_CASE`
    code; all 15 catalog codes match `` `CRUDO_${string}` ``. PASS.
  - **Factories** — `createCrudo`, `createCrud`, `createCrudContext`,
    `createOperationRegistry`, `createTypeOrmInfrastructure`, `createTypeOrmCrudo`.
    PASS. (Borderline, judged conforming, no change: `builtInHandlers` /
    `builtInPaginationStrategies` construct values but name a *set of built-ins*
    contrasted with user-supplied ones, which is the more informative name; the
    rule targets composition-root factories and those all comply.)
  - **Config keys** — every key in `CrudoSettings`, `EntityConfig`,
    `OperationConfig`, `GlobalConfig`, `CrudoModuleOptions`, `CrudRouteOptions`
    is camelCase; all 9 boolean keys are positively phrased (`count`,
    `exposeInternals`, `includable`, `defaultInclude`, `enabled`, `withDeleted`,
    `retryable`) — no `hide*`/`no*`/`disable*` anywhere. PASS.
  - **No `I` prefix** — tree-wide grep for `interface I<Capital>` returns nothing. PASS.
  - **Data access** — `EntityReader` + `EntityWriter`, `RepositoryAdapter`
    extends both, adapter named `TypeOrmRepositoryAdapter`. PASS.
  Two non-findings recorded so they aren't re-litigated: (a) Nest DI tokens
  `CRUDO_INSTANCE`/`CRUDO_MODULE_OPTIONS` share the `CRUDO_` SCREAMING_SNAKE
  prefix with error codes, but that rule is scoped to exception codes and
  SCREAMING_SNAKE constants are conventional; (b) custom-operation route config
  is `meta.routes` in code vs. a top-level `http` key in the spec's Phase 13
  *example* — ADR-0007 explicitly rejected the top-level `http` field (it leaks
  HTTP into core), so the code is correct and the example is the stale artifact.
  Docs-only phase; `pnpm check` run to confirm the tree is green.
- Phase 3: Docs-only, no code changed. **Placement decision: extended the
  existing catalog at `architecture/01-system-architecture.md` §6 rather than
  adding a `13-design-patterns.md`.** The phase's premise ("patterns are
  implicit, spread across ADRs") turned out to be only half true — doc 01 §6
  ("Design patterns, and why") already named 7 patterns with rationale and a
  rejected-alternatives list, and `packages/docs/README.md:8` already advertises
  doc 01 as the patterns doc. A new numbered file would have created a second,
  competing catalog for the two to drift apart. What §6 genuinely lacked is what
  the phase asked for: the implementation file per pattern and the motivating ADR.
  Added both, verified against the code rather than the plan's list:
  - Kept and located: **Template Method** (`crud-engine.ts` — noted that
    variability is by injected collaborator, not subclass override; `run` is
    private and nothing extends `CrudEngine`), **Strategy** (all 5 real
    interface-backed seams named individually), **Registry** (ADR-0006, ADR-0007),
    **Specification** (Filter AST — qualified: composition only, the AST is pure
    data with no evaluation method), **Interpreter** (`FilterTranslator.toBrackets`),
    **Dependency Injection**, **Facade** (`DefaultCrudService`).
  - Added, both genuinely in use and both missing from §6: **Composition Root**
    (`crudo.ts` + the two framework-layer roots) and **Adapter**
    (`TypeOrmRepositoryAdapter` + the `CrudInfrastructure` metadata/adapter
    family; ADR-0001, ADR-0011).
  - Deliberately not added (would have inflated the catalog): `HARD_DELETE` as
    Null Object (one constant is not a pattern in use), `WireQuery` as Marker
    (too small), TS module augmentation as Extension Object (a language
    mechanism, already covered by ADR-0007).
  - Cross-linked doc 07 §4's shorter per-doc pattern list to doc 01 §6 so the
    two can't silently diverge. README already reaches §6, so no index change.
  **Phase 3a proposed (found, flagged, NOT fixed): the Strategy pattern is
  applied inconsistently in the query subsystem.** `CrudEngineDependencies`
  (`packages/core/src/engine/crud-engine.ts:31-39`) types every collaborator as a
  core-declared interface — `Serializer`, `Deserializer`, `ErrorHandler`,
  `OperationRegistry` — except `normalizer`, which is typed as the **concrete**
  `QueryNormalizer` class (line 37). There is no `QueryNormalizer` contract in
  core. Relatedly, core declares and exports a `FilterParser` interface
  (`query/filter-parser.ts`) that `DefaultFilterParser` correctly implements, but
  `QueryNormalizer` hard-instantiates `new DefaultFilterParser(metadata)` in its
  constructor (`query/query-normalizer.ts:31,38`), so that declared seam is not an
  injection point either — the same "declared contract, never wired" shape Phase 1
  found in `FilterBuilder`. Within the same subsystem, `PaginationStrategy` and
  `IncludeResolver` *are* injected as interfaces, which is what makes this an
  inconsistency rather than a uniform choice. Not fixed here: it changes a public
  type (`CrudEngineDependencies`) and needs the coordinator's call on whether the
  normalizer is meant to be swappable at all.
  Also noted for Phase 7 (not fixed, out of scope): doc 01 §9's ADR index stops at
  0010 and is missing ADR-0011 through 0014, two of which §6 now cites.
- Phase 4:
- Phase 5:
- Phase 6:
- Phase 7:
- Phase 8:
