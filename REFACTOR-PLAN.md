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
  **Decision (user): deferred past Phase 8.** Phase 3a is not actioned by this
  refactor. It is revisited alongside Phase 16's DX API work, when the public
  surface is being revised anyway and a `CrudEngineDependencies` change costs
  nothing extra. The finding stands as recorded above.
  Also noted for Phase 7 (not fixed, out of scope): doc 01 §9's ADR index stops at
  0010 and is missing ADR-0011 through 0014, two of which §6 now cites.
- Phase 4: Mixed outcome, comments only — not one executable line moved.
  Reading the two blocks side by side turned up something the plan didn't
  predict: **the class doc's stage order was factually wrong.** It listed
  `DTO resolution → deserialization → query resolution`, but `run()` executes
  query resolution and context assembly *first*, because `createCrudContext`
  carries the normalized query and `resolveInput` takes the context. The class
  doc was reciting `crudo-phases-v6.md` Phase 7's stage list; the code and
  `architecture/07-crud-engine.md` (the authoritative Phase 7 lifecycle) both use
  the real order. So this was less a duplication finding than a stale-comment one.
  - **Fixed the class doc** to the actual execution order and added one WHY
    clause naming the constraint that forces it (context carries the query;
    deserialization needs the context), citing doc 07. That constraint was
    previously encoded nowhere — the inline `// 3–5.` then `// 3–4.` numbering,
    running *backwards*, was the reader's only hint that the code departs from
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
    `describe` rather than once because `@Crud` generates routes at *decoration*
    time (ADR-0012), so each `describe`'s controller/config combination needs its
    own module; Examples can use `beforeAll` because it boots one fixed
    `AppModule`. TypeORM declares entities inline rather than in `support/`
    because each spec needs a *different* schema shape (unique index, relations,
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
    the coordinator rather than actioned.
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
    `to: { path: "^packages/..." }` rule could only ever match a *relative* deep
    path. `import { x } from "@crudo/nest"` inside `@crudo/typeorm` — the natural
    spelling of the forbidden adapter→framework edge — passed `pnpm depcruise`
    clean. Same for `@crudo/nest` → `@crudo/typeorm`. Tried fixing resolution
    with `enhancedResolveOptions` (exportsFields/conditionNames/mainFields); it
    resolved nothing extra and *dropped* 5 modules, so it was abandoned in favor
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
  - **Verified CAUGHT after the change:** core → npm package (runtime *and*
    type-only), core → `@crudo/nest` by name, core → any package's src, typeorm →
    `@crudo/nest` by name, nest → `@crudo/typeorm` by name, typeorm/nest → core
    src (relative), typeorm/nest → `@crudo/core/<subpath>`, examples → core src.
    Clean tree still 102 modules / 401 dependencies, zero false positives.
  - **One spelling still uncatchable, and that is fine:** `@crudo/core/dist/...`
    is swallowed by the `/dist/` exclusion. Tightening that pattern was tried and
    rejected (it pulled a dist module into the graph and still didn't catch it).
    It needs no rule: core's `package.json` `exports` map publishes only `"."`, so
    under Node16 resolution *every* subpath is TS2307 — and unlike the cases
    above, that failure is structural and cannot be silenced by adding a
    dependency. ADR-0010's barrel is enforced by the exports map; depcruise is the
    second line.
  - **`/tests/` exclusion — recommendation, NOT actioned (coordinator's call).**
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
    deliberately — deep-importing another package's `src` is illegal from *any*
    file, test or not, and leaving them broad is what makes a test doing it fail
    under two rules at once.
  - **`tests-no-other-package-internals`** — a test file may import its own
    package's source and the `@crudo/*` barrels, never another package's `src` or
    `tests`. Uses dependency-cruiser's `$1` back-reference: the package root is
    captured in `from.path` and excluded from `to` via `pathNot: "^$1/"`, so
    same-package imports stay legal without enumerating them. Cites ADR-0002.
  - **`core-tests-know-no-adapter`** — added beyond the approved three-point
    shape, because scoping `core-imports-nothing` to `/src` would otherwise have
    left core's *tests* free to import `@crudo/typeorm`. Core must not know an ORM
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
- Phase 7:
- Phase 8:
