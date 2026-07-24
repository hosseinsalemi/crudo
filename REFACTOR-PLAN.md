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

> **Corrected in Phase 8 — the premise above was half right.** The
> _source code_ was clean, and stayed clean: after eight phases the entire
> production-source diff is four hunks of comments plus one type-only
> interface signature. But "clean code" was measured by reading code, and
> two things that are not code turned out not to be clean at all:
>
> - **The enforcement was not enforcing.** Phase 6 found that
>   `.dependency-cruiser.cjs` never matched a workspace package specifier,
>   so the forbidden `@crudo/typeorm → @crudo/nest` edge passed CI when
>   written the way anyone would actually write it. `pnpm depcruise` was
>   green because it was not looking, and Phase 6a found `tests/` excluded
>   from cruising entirely.
> - **The docs had drifted.** Phase 7 found nine architecture docs stale,
>   including a section listing soft delete and includes as unbuilt while
>   two earlier sections of the same file documented them working, and a
>   code example citing a file that does not exist.
>
> The lesson worth keeping: a spec-and-ADR-driven codebase does prevent
> source drift, but it does not protect the artifacts _around_ the source —
> CI rules and prose — and those were exactly where a green build hid the
> problem. An audit that only reads code would have closed this plan at
> Phase 5 with nothing found.

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
  `TransactionManager` as owned/implemented by `@crudo/typeorm`. **(Both fixed in
  Phase 7.)**
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
    `builtInPaginationStrategies` construct values but name a _set of built-ins_
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
    _example_ — ADR-0007 explicitly rejected the top-level `http` field (it leaks
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
    `IncludeResolver` _are_ injected as interfaces, which is what makes this an
    inconsistency rather than a uniform choice. Not fixed here: it changes a public
    type (`CrudEngineDependencies`) and needs the coordinator's call on whether the
    normalizer is meant to be swappable at all.
    **Decision (user): deferred past Phase 8.** Phase 3a is not actioned by this
    refactor. It is revisited alongside Phase 16's DX API work, when the public
    surface is being revised anyway and a `CrudEngineDependencies` change costs
    nothing extra. The finding stands as recorded above.
    Also noted for Phase 7 (not fixed, out of scope): doc 01 §9's ADR index stops at
    0010 and is missing ADR-0011 through 0014, two of which §6 now cites. **(Fixed
    in Phase 7.)**
- Phase 4: Mixed outcome, comments only — not one executable line moved.
  Reading the two blocks side by side turned up something the plan didn't
  predict: **the class doc's stage order was factually wrong.** It listed
  `DTO resolution → deserialization → query resolution`, but `run()` executes
  query resolution and context assembly _first_, because `createCrudContext`
  carries the normalized query and `resolveInput` takes the context. The class
  doc was reciting `crudo-phases-v6.md` Phase 7's stage list; the code and
  `architecture/07-crud-engine.md` (the authoritative Phase 7 lifecycle) both use
  the real order. So this was less a duplication finding than a stale-comment one.
  - **Fixed the class doc** to the actual execution order and added one WHY
    clause naming the constraint that forces it (context carries the query;
    deserialization needs the context), citing doc 07. That constraint was
    previously encoded nowhere — the inline `// 3–5.` then `// 3–4.` numbering,
    running _backwards_, was the reader's only hint that the code departs from
    the spec's stage order, and it never said why.
  - **Trimmed 4 of 6 inline comments** that were pure stage labels the corrected
    class doc now owns: `// 3–5. Query resolution and context assembly`,
    `// 3–4. DTO resolution + deserialization (writes)`, `// 6. Handler
execution`, and `// 7–8. Response mapping + serialization (DTO mapping →
field selection)`. The first three restate the call directly beneath them;
    the fourth's only real content — that DTO mapping precedes field selection —
    is already normative at the `Serializer` contract (`serialization/serializer.ts`),
    which is where a reader of `mapResponse` (it just delegates to the serializer)
    would look.
  - **Kept 2, rewritten to drop the stage-number prefix and keep the WHY**:
    "nothing is special-cased per verb — built-ins are ordinary registry entries",
    now citing ADR-0006 explicitly; and "per-call overrides are parameters, never
    writes to the frozen resolved config". Both encode non-obvious constraints
    that `registry.get(...)` and `this.configViewFor(request)` cannot state for
    themselves.
    Net: the pipeline shape is documented once (class doc), each surviving inline
    comment carries only WHY, and the one genuine constraint the numbering hid is
    now stated in prose.
- Phase 5: Full pass over all 15 test files (3,112 lines, 4 locations — the
  three named plus `packages/examples/tests/`). **Verdict: conventions are
  consistent and every cross-package difference is layer-justified.** One real
  in-package duplication found and fixed; one cross-package duplication found
  and deliberately left alone.
  - **Per-package conventions, each internally consistent.** Core: no
    `beforeEach` anywhere — every spec builds its subject through a local
    `makeX()` factory (`makeCrud`, `makeAccountCrud`, `blog`), with entities and
    fakes imported from `tests/support/*-fixture.ts`. TypeORM: all three specs use
    the identical `beforeAll` (new `DataSource` → `initialize`) / `afterAll`
    (`destroy`) / `beforeEach` (`clear()` repos in FK-safe child-before-parent
    order) triple, entities declared inline per spec with explicit column types.
    Nest: a module-level `bootstrap(controller)` + `afterEach(app.close)`, with a
    fresh Testing module per `describe`. Examples: one `beforeAll`/`afterAll` app.
  - **Differences checked, all forced by the layer.** Core has no `beforeEach`
    because it has no external resource to reset — its factories are pure, so
    per-test isolation comes free; TypeORM needs `beforeEach` truncation because a
    shared in-memory SQLite connection carries rows between tests. Nest builds per
    `describe` rather than once because `@Crud` generates routes at _decoration_
    time (ADR-0012), so each `describe`'s controller/config combination needs its
    own module; Examples can use `beforeAll` because it boots one fixed
    `AppModule`. TypeORM declares entities inline rather than in `support/`
    because each spec needs a _different_ schema shape (unique index, relations,
    `@DeleteDateColumn` vs. config-named marker) and `synchronize: true` builds it
    per file. None of these is arbitrary.
  - **Fixed (real, mechanical, same package):** `issuesOf` — 9 byte-identical
    lines unwrapping a `QueryValidationException` — was duplicated in
    `core/tests/filter-parser.spec.ts` and `core/tests/query-normalizer.spec.ts`.
    Exactly 2 call sites, same package, solving the same problem, and
    `tests/support/` already existed as the home, so extraction cost no boundary
    and no new concept. Now `core/tests/support/query-issues.ts`.
  - **Found but NOT extracted (boundary beats DRY):** `InMemoryTodoAdapter`
    (`nest/tests/support/fake-infrastructure.ts`) and `InMemoryAccountAdapter`
    (`core/tests/support/account-fixture.ts`) share ~40 lines of near-identical
    soft-delete fake (`visible`/`delete`/`restore`/`purge`/`require`). This is
    genuine duplication, not similar-looking code — but any shared home is worse
    than the duplication: `@crudo/nest` importing `packages/core/tests/...` is a
    deep cross-package import the architecture forbids, and a new shared test
    package is disproportionate. Worth flagging separately: `.dependency-cruiser.cjs`
    excludes `/tests/` from cruising entirely, so such an import would **not** fail
    `pnpm depcruise` — the boundary is convention-only inside `tests/`. Reported to
    the coordinator rather than actioned. **(Phase 6a closed the enforcement gap:
    that import now errors under `tests-no-other-package-internals`. The
    duplication itself remains, still by choice — the rule is what makes the choice
    stick.)**
  - **Judged not-duplication:** the three core in-memory adapters
    (`InMemoryUserAdapter`, `InMemoryAccountAdapter`, `SeededAdapter`) share
    row-array mechanics but diverge exactly where each test needs it — User
    deliberately skips filter evaluation, Account reads `context.config.softDelete`
    rather than deciding for itself, Seeded returns pre-stitched rows. Each carries
    a comment saying why. Collapsing them would erase the distinctions the tests
    exist to make. Likewise `server()` (2 lines) in the two e2e suites.
    Test count unchanged at 166/166.
- Phase 6: Rules verified **by construction**, not by assumption — 16 probes,
  each injecting one illegal import, running `depcruise`, and reverting. Found
  and closed a real gap: **the two most important rules were not firing on the
  spelling anyone would actually write.**
  - **Root cause.** Workspace package specifiers are `couldNotResolve: true` to
    dependency-cruiser (verified via `--output-type json`), so every
    `to: { path: "^packages/..." }` rule could only ever match a _relative_ deep
    path. `import { x } from "@crudo/nest"` inside `@crudo/typeorm` — the natural
    spelling of the forbidden adapter→framework edge — passed `pnpm depcruise`
    clean. Same for `@crudo/nest` → `@crudo/typeorm`. Tried fixing resolution
    with `enhancedResolveOptions` (exportsFields/conditionNames/mainFields); it
    resolved nothing extra and _dropped_ 5 modules, so it was abandoned in favor
    of matching the raw specifier, which the JSON output confirms is what
    `to.path` holds for an unresolved dependency.
  - **Why the backstop wasn't one.** `tsc -b` does reject those imports (TS2307),
    but only because the package isn't in that package's `package.json` — i.e.
    it fails for a reason the offender removes as their next step. Add
    `@crudo/nest` to `@crudo/typeorm`'s dependencies and tsc goes quiet while
    depcruise stays silent. That is the hole.
  - **Fixed (3 rules, additive — nothing loosened):** `typeorm-only-imports-core`
    → `^(packages/frameworks|@crudo/nest)`; `nest-only-imports-core` →
    `^(packages/orms|@crudo/typeorm)`; `no-cross-package-deep-imports-core` →
    `^(packages/core/src/.+|@crudo/core/.+)` with `packages/examples` added to
    `from` (it was in no rule's scope at all, and it is the reference app).
    Comments now cite ADR-0002 and ADR-0010.
  - **Verified CAUGHT after the change:** core → npm package (runtime _and_
    type-only), core → `@crudo/nest` by name, core → any package's src, typeorm →
    `@crudo/nest` by name, nest → `@crudo/typeorm` by name, typeorm/nest → core
    src (relative), typeorm/nest → `@crudo/core/<subpath>`, examples → core src.
    Clean tree still 102 modules / 401 dependencies, zero false positives.
  - **One spelling still uncatchable, and that is fine:** `@crudo/core/dist/...`
    is swallowed by the `/dist/` exclusion. Tightening that pattern was tried and
    rejected (it pulled a dist module into the graph and still didn't catch it).
    It needs no rule: core's `package.json` `exports` map publishes only `"."`, so
    under Node16 resolution _every_ subpath is TS2307 — and unlike the cases
    above, that failure is structural and cannot be silenced by adding a
    dependency. ADR-0010's barrel is enforced by the exports map; depcruise is the
    second line.
  - **`/tests/` exclusion — recommendation, NOT actioned here; approved and done
    as Phase 6a.**
    Measured it: removing `/tests/` from the exclusion fails immediately with
    **10 errors**, all `core-imports-nothing` on core's own test files importing
    `@crudo/core`. That is not drift — it is the rules' `from: "^packages/core"`
    scope catching `packages/core/tests/`, which legitimately imports the barrel
    (and vitest). So enabling test cruising is not a one-line flip: it requires
    re-scoping every rule's `from` to `/src` first, then adding a tests-specific
    rule (the `from`-group back-reference recipe: a test file may import its own
    package and the `@crudo/*` barrels, never another package's `src`/`tests`).
    **Recommendation: do it, as its own change.** The benefit is concrete — it is
    the last unenforced boundary, and it would have mechanically caught the
    cross-package fixture import declined in Phase 5. The cost is bounded and
    mechanical. Not done here because it touches every rule and would change what
    CI enforces.
- Phase 6a: The `tests/` boundary is now mechanically enforced instead of
  convention-only. Approved follow-on to Phase 6's measurement.
  - **Config changes (all additive — no Phase 6 rule was relaxed).** `from`
    scoped to `/src` on the three package-purity rules (`core-imports-nothing`,
    `typeorm-only-imports-core`, `nest-only-imports-core`) so they stop firing on
    test files; `/tests/` dropped from `options.exclude` (`\\.d\\.ts$|/dist/`
    remains); two rules added. The deep-import rules kept their broad `from`
    deliberately — deep-importing another package's `src` is illegal from _any_
    file, test or not, and leaving them broad is what makes a test doing it fail
    under two rules at once.
  - **`tests-no-other-package-internals`** — a test file may import its own
    package's source and the `@crudo/*` barrels, never another package's `src` or
    `tests`. Uses dependency-cruiser's `$1` back-reference: the package root is
    captured in `from.path` and excluded from `to` via `pathNot: "^$1/"`, so
    same-package imports stay legal without enumerating them. Cites ADR-0002.
  - **`core-tests-know-no-adapter`** — added beyond the approved three-point
    shape (flagged as such, and kept on review), because scoping
    `core-imports-nothing` to `/src` would otherwise have
    left core's _tests_ free to import `@crudo/typeorm`. Core must not know an ORM
    exists, and its suite proves that by running the engine against an in-memory
    fake; this keeps the part that still matters enforced (ADR-0005, ADR-0001)
    while allowing the barrel and vitest that the `/src` scoping was for.
  - **Verification: 22 probes, each injecting one import, cruising, reverting.**
    13 must-be-caught, all caught. Most important: `nest test →
packages/core/tests/support/account-fixture.js` — the exact fixture-sharing
    import declined in Phase 5 — now errors under
    `tests-no-other-package-internals`. That call no longer rests on reviewer
    judgment. Also caught: nest/typeorm/examples tests → another package's `tests`
    or `src` (relative), core tests → `@crudo/typeorm` and `@crudo/nest` (barrel
    spelling) and → typeorm `src` (relative). All 6 Phase 6 production probes
    still fail as they should — re-verified, not assumed.
  - **9 negative controls, none tripped:** core test → `@crudo/core`, → own `src`,
    → own `tests/support`; nest test → own `src`, → `@crudo/core`; typeorm test →
    `@crudo/typeorm`, → vitest; examples test → own `src`. Clean tree is green with
    **no test file edited to accommodate a rule**: 120 modules / 452 dependencies
    cruised (up from 102 / 401 — that delta is the test suite, previously invisible).
- Phase 7: Architecture docs diffed against the code they describe. The four
  carried-forward items were real and are fixed; the fresh pass found **six
  more**, the largest being a doc section that contradicted its own earlier
  sections. One systematic discrepancy is reported unfixed as ambiguous.
  - **Carried forward, fixed.** (1) `TransactionManager` removed from the
    `@crudo/typeorm` "Owns" cell in doc 01 §3, and doc 03 §5's Transactions row
    changed from "Phases 9–10 (adapter-level hook)" to "Not implemented", with a
    paragraph under the inventory recording why it stays and that
    `TransactionContext` is the live exception. (2) Doc 01 §9's ADR index extended
    with ADR-0011…0014. (3) Doc 02 §3 now states the two load-bearing properties
    of the rule set from Phases 6/6a: both spellings matched, `packages/examples`
    in scope, and `tests/` cruised with the per-package import rule spelled out.
    (4) No architecture doc repeats the spec's stale top-level `http` key — they
    all use `meta.routes` — so nothing to fix; see the spec note below.
  - **Found in the fresh pass, fixed.** Doc 09 §6 ("Attachment points for later
    phases") was the worst: it listed soft delete and includes as _unbuilt_ —
    "the strategy branch lives in `delete` (currently hard)", "`buildQuery` grows
    `leftJoinAndSelect`" — while §2 and §3 of the same doc already documented both
    as working, and it numbered the phases wrong (transactions "13", soft delete
    "15", includes "16"; actually 14 and 15). Rewritten to record both as landed
    with transactions the only remaining seam. Same doc: the intro's "skeleton
    scope" line and §7's "No N+1 in skeleton scope (no relation loading)" — false
    since batch loading landed. Doc 11's "Once includes land (Phase 15)" — they
    landed. Doc 03 §3's augmentation example cited
    `nest/src/augmentation.ts`, a file that does not exist (it is
    `operation-metadata.ts`), and showed a `swagger?` key the real
    `CrudRouteOptions` has never had while omitting `successStatus`. Doc 06's
    `CRUDO_QUERY_UNSUPPORTED_PARAM` row listed `include`/`fields[relation]` as
    unsupported — includes are built; that code now fires only when no include
    resolver is wired. Doc 07's `transaction` described as `null` when a
    programmatic caller may pass one through `CrudCallOptions`. Doc 01's opening
    promised "the `*Many` batch variants" as part of what you get (bulk is not
    built — its entries are registered disabled) and its §4 lifecycle still
    marked `IncludeTree` as `⟨deferred⟩`.
  - **Doc 05, two fixes.** "property-tested in `filter-parser.spec.ts`" — there is
    no property-based testing in the repo (no fast-check); the JSON/bracket
    equivalence is an example-based assertion. And "Relation-path values pass
    through as strings in Milestone B (target-entity metadata is wired in Phase
    15)" — Phase 15 shipped without wiring it: `DefaultFilterParser` builds its
    field map from the **root** entity's columns only, so `filter[profile.city]`
    still coerces as a string. Doc now states current behavior instead of
    promising a phase that has passed. **Whether the code should coerce
    relation-path values against target metadata is a separate question, left
    open — it is a behavior change, not doc sync.**
  - **Verified clean, no change:** doc 08's defaults table (all 13 keys match
    `BUILT_IN_DEFAULTS` exactly), doc 06's 15 error codes and statuses (match
    `ERROR_CATALOG` exactly), doc 05's 13-operator table (matches
    `WIRE_OPERATORS`), doc 10's route table (matches `STANDARD_ROUTES`), doc 12's
    include limits/strategies/alias scheme/count behavior (verified against
    `default-include-resolver.ts` and the adapter), doc 04's slot defaults and
    `dtoShapeKeys` semantics. Every `path/to/file.ts` cited across the
    architecture docs was resolved against the tree; all exist (after the
    `augmentation.ts` fix).
  - **Reported, NOT fixed — ambiguous.** Doc 03 §1's generic-parameter table and
    §2 name the type parameters `TEntity`, `TCreateDto`, `TUpdateDto`,
    `TPatchDto`, `TQueryDto`, `TItemDto`, `TListDto`, `FieldPath<TEntity,
TMaxDepth>`; the code uses un-prefixed `Entity`, `CreateDto`, …,
    `FieldPath<Entity, MaxDepth>`. ADR-0006 (`OperationRegistry<TEntity>`) and
    ADR-0008 (`FieldPath<TEntity>`) carry the same prefix. Reading A: real drift
    from a `T`-prefix removal the docs never followed. Reading B: `T*` is
    expository placeholder notation, not a claim about identifiers. Not guessed
    at, because the fix differs per reading and one candidate — renaming the
    code's parameters — is out of Phase 7's scope entirely. The spec's Naming
    Conventions section is silent on type-parameter naming, so nothing is in
    violation either way. Also unfixed by design: ADR prose, which is a historical
    record rather than a doc to sync.
  - **Spec discrepancy for the user (no edit made).** `crudo-phases-v6.md:847-853`
    shows custom operations taking a top-level `http: { method, path }` / `http:
false`, but ADR-0007 explicitly rejected a top-level `http` field (it leaks
    HTTP into core) in favor of `meta.routes`, and Phase 3's own text describes
    the opaque `meta` slot. Code and all architecture docs follow the ADR; the
    spec example is the outlier. Candidate for an erratum — the user's call.
- Phase 8: Final gate. `pnpm check` green — `tsc -b` clean, depcruise
  `✔ no dependency violations found (120 modules, 452 dependencies cruised)`,
  **166/166 tests, the same count the refactor started with.**
  - **The refactor kept its word: no behavior changed.** The complete
    production-source diff across all eight phases (`git diff f70c1d5..HEAD --
packages/*/src`) is four hunks in three files. Filtering that diff for lines
    that are neither comments nor blank leaves exactly six: the `FilterBuilder`
    interface signature and its dropped `CrudContext` import, the added
    `import type { FilterBuilder }`, and the `implements FilterBuilder<Entity>`
    clause. Every one of those is `interface` / `import type` / `implements` —
    constructs that erase at compile time. **Not a single runtime line moved in
    `packages/*/src` across the whole refactor.**
  - **File-to-phase mapping — 19 of 20 files trace.** Phase 1:
    `core/src/query/filter-builder.ts`, `orms/typeorm/src/filter-translator.ts`,
    `core/src/persistence/transaction-manager.ts`, `orms/typeorm/README.md`.
    Phase 3: `docs/architecture/01`, `07`. Phase 4:
    `core/src/engine/crud-engine.ts`. Phase 5: `core/tests/filter-parser.spec.ts`,
    `core/tests/query-normalizer.spec.ts`, `core/tests/support/query-issues.ts`
    (new). Phases 6 + 6a: `.dependency-cruiser.cjs`. Phase 7:
    `docs/architecture/01, 02, 03, 05, 06, 07, 09, 10, 11`. Phases 1–8:
    `REFACTOR-PLAN.md`.
  - **One file does not trace: `.claude/agents/test-writer.md`** (+74 lines),
    added by commit `0e17a24` "chore(agents): add a test-writer subagent" — a
    commit outside the refactor's own sequence and unrelated to any phase. Not
    written by this refactor; reported rather than reverted, since the commit is
    already in history and removing it is the maintainer's call.
  - **Pre-existing flake found, not caused here.** The first `pnpm check` of this
    phase failed one test — `examples/tests/app.e2e.spec.ts` "embeds relations
    both ways", `POST /cats` returning 302 instead of 201. It is intermittent: the
    file passes 18/18 in isolation, and the full suite passed 5/5 on retry. It was
    then **reproduced on the pre-refactor tree** (a detached worktree at `f70c1d5`,
    the refactor's starting commit): 2 failures in 12 full-suite runs, versus 1 in
    ~20 on `HEAD`. Combined with the proof above that no runtime line changed, the
    flake is pre-existing and independent of this work. It is a real defect and is
    carried to Open items — a suite that fails ~1 run in 10 will eventually be
    "fixed" by someone re-running CI, which is worse than a red build.
  - Changelog entries re-read against the commits and corrected where later phases
    overtook them (Phase 1's and Phase 3's deferrals to Phase 7 now record that
    Phase 7 fixed them; Phase 5's boundary note records that Phase 6a made it
    enforced; Phase 6's `/tests/` recommendation records that it became Phase 6a).
    The plan's opening premise was also corrected — see the Phase 8 note under
    "Starting point", which records that "the codebase is clean" held for the
    source and not for the CI rules or the docs.

---

## Open items (carried past this plan)

This file goes quiet after Phase 8. These four survive it.

1. **Phase 3a — Strategy applied inconsistently in the query subsystem.**
   `CrudEngineDependencies` types `normalizer` as the concrete `QueryNormalizer`
   while every sibling collaborator is a core-declared interface, and the exported
   `FilterParser` contract is hard-instantiated inside `QueryNormalizer` rather
   than injected. **Deferred past Phase 8 by the user**, to be revisited alongside
   Phase 16's DX API work, when the public surface is being revised anyway. Full
   finding in the Phase 3 entry.
2. **Relation-path filter values are never coerced.** `DefaultFilterParser` builds
   its field map from the **root** entity's columns only, so
   `filter[profile.city][eq]=…` passes through as a string — no target-entity
   metadata, no numeric/date/enum coercion, no allowlist-driven kind check. Doc 05
   promised Phase 15 would wire this; Phase 15 shipped without it. Phase 7
   corrected the doc to describe what the code does. **This is a real behavior gap,
   not doc drift** — deciding whether relation-path filters should coerce (and what
   a mismatch should return) is a feature decision, deliberately left open.
3. **`T`-prefixed type parameters in doc 03 (ambiguous — both readings recorded).**
   Doc 03 §1–§2 name the generics `TEntity`, `TCreateDto`, …,
   `FieldPath<TEntity, TMaxDepth>`; the code uses `Entity`, `CreateDto`, …,
   `FieldPath<Entity, MaxDepth>`. ADR-0006 and ADR-0008 carry the same prefix.
   Reading A: real drift from a `T`-prefix removal the docs never followed —
   fix the docs. Reading B: `T*` is expository placeholder notation — fix nothing.
   A third option, renaming the code's parameters, was out of Phase 7's scope.
   The spec's Naming Conventions section is silent on type-parameter naming, so
   nothing is in violation either way.
4. **Spec erratum candidate — `crudo-phases-v6.md:847-853`.** The spec's Phase 13
   example gives custom operations a top-level `http: { method, path }` /
   `http: false`. ADR-0007 explicitly rejected a top-level `http` field (it leaks
   HTTP into core) in favor of `meta.routes`, which is what the code and every
   architecture doc use — and the spec's own Phase 3 text describes the opaque
   `meta` slot. The spec is the outlier. **The spec is authoritative and was not
   edited: this is the user's call.**
5. **Flaky e2e test (found in Phase 8, pre-existing).**
   `packages/examples/tests/app.e2e.spec.ts` → "embeds relations both ways: a
   joined owner and batched pets (Phase 15)" intermittently gets `302` instead of
   `201` from `POST /cats`, roughly 1 run in 10 of the full suite, never in
   isolation. Reproduced at `f70c1d5` (pre-refactor), so it is not this work.
   Undiagnosed: a 302 from a `POST` points at something outside the route handler
   (Express/Nest middleware or Swagger's UI redirect), not at the CRUD pipeline.
   Worth a real fix rather than a retry, since an intermittently red suite trains
   people to re-run CI.
