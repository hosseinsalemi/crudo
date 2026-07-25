# Crudo Refactor Plan

## How this plan was produced

This is an audit-first plan. Before proposing anything, the tree was read
end-to-end against the four goals asked for — simpler design, deliberate
design patterns, better use of enums, and removal of stale comments — and
cross-checked against `crudo-phases-v6.md`, the ADRs in
`packages/docs/adr/`, and the compiler settings in `tsconfig.base.json`.

**Baseline at time of writing:** `pnpm test` → 11 files, 166 tests, all
green. Milestone C is complete (Phases 1–15: soft delete and includes
shipped; bulk dropped).

### What is *not* wrong

Worth stating plainly, because it bounds the plan: the architecture is
sound and most of it should not be touched. The hub-and-spoke topology is
mechanically enforced rather than merely documented; `CrudEngine.execute`
is a genuine Template Method with injected strategies at every seam; the
operation registry really does drive both the engine and route generation;
`createCrudo` is a real composition root. Naming follows the spec's
normative section. A previous plan (`REFACTOR-PLAN.md`, now deleted) already
closed eight phases of comment, CI-rule, and doc-drift cleanup.

So this plan does **not** propose restructuring anything. Every finding
below is one of three kinds:

1. a closed set that the type system knows about but the code doesn't
   consult (the enum goal — this is where the real wins are);
2. one piece of knowledge spelled out in several places with no mechanical
   link between them (the drift risk);
3. a comment or type that asserts something no longer true.

### The one honest framing note

The largest single simplification available — dropping the bulk
scaffolding (Group C) — is a **product decision, not a refactor**. It is
written up with both paths costed because it is not mine to make.

---

## Ground rules for every step

Carried forward from CLAUDE.md so they don't need repeating per step:

- `pnpm check` (build + depcruise + test) is the exit gate for every step.
- No behavior change without a failing test first. Steps that are
  intentionally behavior-preserving should show 166 tests still green.
- Comments stay WHY-only. Don't add comments while touching a file unless
  the change introduces a non-obvious constraint.
- No new abstraction unless the step's own audit finds ≥2 real call sites.
- Each step below is independently reviewable and independently
  revertable. Where a step depends on an earlier one, it says so.

---

## Group A — Make the closed sets load-bearing

**This is the "better use of enums" goal, and it is the highest-value
group in the plan.**

First, a constraint that rules out the obvious move. `tsconfig.base.json`
sets `isolatedModules: true` and `verbatimModuleSyntax: true`. Under
`isolatedModules`, `const enum` is banned outright, and a plain TS `enum`
emits a runtime object with reverse-mapping and is famously awkward to
tree-shake. **So "use more enums" must not mean "use the TypeScript `enum`
keyword."** It means: give each closed set a single declaration that
produces both the type and, where one is needed, the runtime value list —
and then make every use site consult it.

The codebase already has the right pattern and uses it in exactly one
place: `ERROR_CATALOG` in
[error-catalog.ts:104](packages/core/src/errors/error-catalog.ts:104) is
`as const satisfies Record<CrudoErrorCode, ErrorCatalogEntry>`, with the
type derived from the object. That is the model to spread.

Today the other closed sets — `FilterOperator`, `LogicalOperator`,
`OperationKind`, `OperationCardinality`, `FieldKind`, `DtoSlot` — are
type-only unions whose use sites take `string`. The type system knows the
set is closed; the code never asks.

### A1 — Add an `assertNever` exhaustiveness helper

**Why:** there is no exhaustiveness helper anywhere in the tree (grepped:
zero hits for `assertNever`/`exhaustive`). Every subsequent step in this
group needs one, so it lands first and alone.

**What:** add to `packages/core/src/types/utility.ts`:

```ts
/** Compile-time proof a switch covered every member of a closed union. */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${String(value)}`);
}
```

Export it from the core barrel — the adapter packages need it too, and
`.dependency-cruiser.cjs` only permits barrel imports.

**Exit:** helper exists and is exported; `pnpm check` green. No call sites
yet.

### A2 — Close the filter-operator switch in the TypeORM translator

**Why:** this is the one place in the tree where a missing enum case is a
**silent correctness bug**, not a compile error.
[filter-translator.ts:87](packages/orms/typeorm/src/filter-translator.ts:87)
switches over all 13 `FilterOperator` members and returns `void` with no
`default:`. `noImplicitReturns` is not set, and the function returns
nothing anyway — so adding a 14th operator to `FilterOperator` compiles
clean here, and the new operator silently contributes **no SQL predicate**.
A filter the user wrote would be quietly ignored and rows they meant to
exclude would come back. That is a security-adjacent failure mode in a
filtering framework.

**What:** add `default: assertNever(condition.operator, "filter operator")`
to the switch. Depends on A1.

**Exit:** deleting any single `case` from the switch now fails `pnpm build`.
Verify that by hand once, then restore. 166 tests still green.

### A3 — Guarantee every AST operator has a wire token

**Why:**
[default-filter-parser.ts:15](packages/core/src/query/default-filter-parser.ts:15)
declares `WIRE_OPERATORS: Readonly<Record<string, FilterOperator>>`. The
`string` key means the table is checked in one direction only: every value
must be a valid `FilterOperator`, but **nothing requires every
`FilterOperator` to have a wire token**. Add an operator to the union and
this table compiles unchanged — the operator becomes unreachable from
HTTP with no diagnostic. The spec calls this table "the Phase 5
single-source-of-truth table," which is precisely what the `string` key
prevents it from being.

**What:** invert the declaration so the table proves its own totality:

```ts
const WIRE_OPERATORS = {
  eq: "EQ", ne: "NE", /* … */ isNotNull: "IS_NOT_NULL",
} as const satisfies Record<string, FilterOperator>;

/** The camelCase wire spelling of each AST operator. */
export type WireOperatorToken = keyof typeof WIRE_OPERATORS;

// Compile-time proof the table covers the whole AST enum:
type _Total = Exclude<FilterOperator, (typeof WIRE_OPERATORS)[WireOperatorToken]> extends never
  ? true
  : ["wire token missing for", Exclude<FilterOperator, (typeof WIRE_OPERATORS)[WireOperatorToken]>];
const _total: _Total = true;
```

If the `_total` line reads as too clever for the codebase's taste, the
plainer equivalent is a second `satisfies` on a derived record. Either
way the requirement is the same: **adding a `FilterOperator` must not
compile until its wire token exists.**

**Exit:** adding a dummy member to `FilterOperator` fails the build in both
A2 and A3 locations. 166 tests green.

### A4 — Correct the stated rationale for not using `enum`

**Why:** [filter.ts:8](packages/core/src/query/filter.ts:8) says
`FilterOperator` is a union "rather than an `enum` so `@crudo/core` stays
free of runtime code." **That rationale is factually wrong.** ADR-0005 is
about zero runtime *dependencies*, not zero runtime code, and core ships
plenty of runtime code — `ERROR_CATALOG`, `BUILT_IN_DEFAULTS`,
`STANDARD_OPERATIONS`, `CrudEngine`, every exception class, all exported
from the barrel. A future contributor who takes this comment at face value
will draw the wrong boundary about what core may contain.

**What:** replace with the real reasons — `isolatedModules` bans
`const enum`, plain `enum` emits a reverse-mapped runtime object that
doesn't tree-shake, and nominal enum typing would force adapters to import
a value from core just to spell an operator. Apply the same correction to
`LogicalOperator` if it repeats the claim.

**Exit:** the comment states a reason that survives inspection. Docs-only.

### A5 — Type the `FieldKind` switch as closed

**Why:** [value-coercion.ts:32](packages/core/src/query/value-coercion.ts:32)
switches over all six `FieldKind` members and today happens to be safe —
the function's return type forces every branch to return. That safety is
incidental, not declared. It survives only as long as nobody adds an early
`return` or a `default:`.

**What:** add `default: assertNever(metadata.kind, "field kind")`. This is
the cheapest step in the plan and makes the guarantee explicit rather than
emergent. Depends on A1.

**Exit:** `pnpm check` green; 166 tests.

---

## Group B — One operation table, not ten

**Why this group exists:** ADR-0006 says operations are registry-driven and
nothing is special-cased per verb. The engine honors that. The satellite
tables around it do not — and, importantly, **the fix is not "make
everything exhaustive."** Some `default:` branches are load-bearing:
custom operations (Phase 13) *must* fall through them. So this group is
deliberately surgical.

Standard-operation knowledge currently lives in ten places:

| # | Site | Knowledge | Keyed by |
|---|---|---|---|
| 1 | [default-operation-registry.ts:76](packages/core/src/operations/default-operation-registry.ts:76) `STANDARD_OPERATIONS` | kind, cardinality, enabled | `StandardOperationId` ✅ |
| 2 | [crud-engine.ts:42](packages/core/src/engine/crud-engine.ts:42) `INPUT_SLOTS` | operation → DTO slot | `string` ❌ |
| 3 | [crud-engine.ts:175](packages/core/src/engine/crud-engine.ts:175) `resolveInput` switch | operation → input shape | switch + `default` (intentional) |
| 4 | [crud-engine.ts:222](packages/core/src/engine/crud-engine.ts:222) `mapResponse` | `findMany` special case | `if` |
| 5 | [built-in-handlers.ts:42](packages/core/src/engine/built-in-handlers.ts:42) | operation → behavior | `StandardOperationId` ✅ |
| 6 | [crud.decorator.ts:16](packages/frameworks/nest/src/crud.decorator.ts:16) `STANDARD_ROUTES` | operation → HTTP route | `string` ❌ |
| 7 | [crud.decorator.ts:35](packages/frameworks/nest/src/crud.decorator.ts:35) `BODYLESS_WRITES` | no-body writes | `string` ❌ |
| 8 | [crud.decorator.ts:167](packages/frameworks/nest/src/crud.decorator.ts:167) `makeHandler` | operation → service call | switch + `default` (intentional) |
| 9 | [swagger.ts:218](packages/frameworks/nest/src/swagger.ts:218) `successBodyFor` | operation → response schema | switch + `default` (intentional) |
| 10 | [swagger.ts:337](packages/frameworks/nest/src/swagger.ts:337) `bodyDtoFor` | operation → request DTO | switch + `default` (intentional) |

Sites 3, 8, 9, 10 are **correct as-is** — their `default:` is the custom-
operation path. The problems are the three `string`-keyed tables (2, 6, 7)
and one genuine duplication (10).

### B1 — Key the standard-operation tables by `StandardOperationId`

**Why:** `INPUT_SLOTS`, `STANDARD_ROUTES`, and `BODYLESS_WRITES` are each
about standard operations exclusively, yet each is keyed by `string`. A
typo (`"pathcOne"`) compiles silently and produces an entry that is never
read. Keying by the union costs nothing and catches that at build time.

**What:**
- `INPUT_SLOTS: Readonly<Partial<Record<StandardOperationId, DtoSlot>>>`
- `STANDARD_ROUTES: Readonly<Partial<Record<StandardOperationId, {…}>>>`
- `BODYLESS_WRITES: ReadonlySet<StandardOperationId>`

`Partial` is correct and deliberate for all three — not every standard
operation takes a body or has a default route. Lookups by the wider
`OperationId` will need one narrowing cast at the boundary; keep it to a
single well-commented spot per file.

**Exit:** `pnpm check` green; 166 tests. A misspelled key now fails to
compile.

### B2 — Stop re-deriving the DTO fallback chain in Swagger

**Why:** the fallback chain — `patch` falls back to `update`, `list` falls
back to `item` — is defined in
[default-dto-resolver.ts:25](packages/core/src/dto/default-dto-resolver.ts:25).
Swagger re-implements it independently: `bodyDtoFor`
([swagger.ts:337](packages/frameworks/nest/src/swagger.ts:337)) rebuilds
patch→update, and `successBodyFor`
([swagger.ts:218](packages/frameworks/nest/src/swagger.ts:218)) rebuilds
list→item. They agree today. Nothing keeps them agreeing, and when they
diverge the symptom is the worst kind: **published API documentation that
lies about the real request/response shape**, with every test still green.

**What:** construct a `DefaultDtoResolver` from the config's `dto` map at
decoration time and let Swagger call `resolve(slot, id)`. This is feasible
precisely because the resolver depends only on the DTO map — not on
`EntityMetadata` or infrastructure — so it is legal at decoration time
where ADR-0012 says no ORM metadata exists.

**What this does *not* change:** the `default:` branches stay. Only the
slot-fallback logic moves behind the resolver.

**Exit:** the fallback chain has exactly one definition. Add a test
asserting the generated `patch` schema follows a registered `update` DTO
when no `patch` DTO is given.

### B3 — Soften the decorator's overstated doc comment

**Why:**
[crud.decorator.ts:52](packages/frameworks/nest/src/crud.decorator.ts:52)
claims "Because generation reads the registry rather than a verb list,
later phases add routes by adding entries — **this file does not change**."
The file contains three verb lists (`STANDARD_ROUTES`, `BODYLESS_WRITES`,
`makeHandler`'s switch). The claim is true for *custom* operations and
false for new *standard* ones.

**What:** narrow the claim to what actually holds. One or two sentences.

**Exit:** the comment matches the file. Docs-only; do after B1/B2 so it
describes the end state.

---

## Group C — Bulk: decide, then act

**This group needs a decision from you before any step runs.**

`crudo-phases-v6.md` (~line 911) is explicit: *"If bulk is out of scope for
a given build, drop it — the single-item CRUD surface is complete without
it."* Bulk was dropped. The scaffolding was not: it is threaded through
**19 source files** — `BulkResultDto`, `BulkItemFailureDto`, `BulkItemIssueDto`,
`BulkOperationException`, `CRUDO_BULK_FAILED`, `BulkMode`, `BulkSettings`,
the `bulk` config key with its validator, the `bulk` leg of every
`CrudResponse`, five `*Many` service methods, and six disabled
`*Many` registry entries.

The scaffolding is not harmless. Two concrete defects follow from it:

- **A type lie in the public service surface.**
  `DefaultCrudService.createMany` and its four siblings return
  `response.bulk as BulkResultDto<ItemDto>`
  ([default-crud-service.ts:65](packages/core/src/service/default-crud-service.ts:65),
  and lines 114, 140, 151, 163). But `CrudEngine.mapResponse` sets
  `bulk: null` on **every one of its three return paths** — there is no
  code path that produces a non-null `bulk`. The cast launders `null`
  into a non-nullable return type. Today it's masked because the `*Many`
  operations are disabled and throw first; the cast is a landmine
  regardless.
- **A stale promise in the type system.** `CrudService` — a public,
  exported interface — advertises five methods that cannot succeed.

**Option 1 (recommended): drop it, per the spec's own instruction.** Delete
the bulk types, exception, catalog entry, config key, service methods, and
`*Many` registry entries. Re-add from git history if bulk is ever built —
the spec still describes it in full. Biggest single simplification in the
plan; removes the type lie by construction.

**Option 2: keep the reservation, remove the lie.** Keep the types as
declared future surface, but make the service methods honest — have them
throw `OperationDisabledException` directly instead of casting `null`, and
mark the interface methods clearly as unimplemented, the way
`TransactionManager` was handled in the previous plan's Phase 1.

**Do not** leave it as-is: the `as BulkResultDto` cast is wrong under both
options.

### C1 — Confirm the decision, then execute in one reviewable commit

Whichever option, the change is mechanical and should land as a single
commit so it can be reverted whole. Steps C2/C3 below apply to Option 1;
under Option 2 they collapse into one small edit.

### C2 (Option 1 only) — Remove the runtime and config surface

`BulkOperationException`, `CRUDO_BULK_FAILED`, the `items` leg of
`toProblemDetails`, `BulkMode`/`BulkSettings`, `bulk` in
`BUILT_IN_DEFAULTS` and `validateSettings`, and the `bulk` entry in
`resolve-entity-config.ts`'s settings key list.

**Watch for:** `ProblemDetailsDto.items` is RFC-9457 extension surface. If
anything else may use per-item issues later, keep `BulkItemIssueDto` and
say why.

### C3 (Option 1 only) — Remove the type and service surface

The five `*Many` methods from `CrudService` and `DefaultCrudService`, the
`bulk` leg of `CrudResponse`, `BulkResultDto`/`BulkItemFailureDto`, the six
`*Many` entries in `STANDARD_OPERATIONS`, their `INPUT_SLOTS` entries, and
the `*Many` members of `StandardOperationId`.

**Bonus:** with `*Many` gone, `builtInHandlers`' fallback branch
([built-in-handlers.ts:101](packages/core/src/engine/built-in-handlers.ts:101))
becomes dead and its `Partial<Record<…>>` becomes a total
`Record<StandardOperationId, …>` — a real exhaustiveness win that arrives
for free.

**Exit:** `pnpm check` green. Test count will drop only if tests assert
bulk-disabled behavior; check before assuming 166 still holds.

---

## Group D — Stale comments

All four are load-bearing claims that are now false. Independent one-line
edits; can land as a single commit.

### D1 — `crud-engine.ts` says Phase 15 hasn't landed

[crud-engine.ts:64–66](packages/core/src/engine/crud-engine.ts:64): "the
include stage holds a plain default **until Phase 15 lands**." Phase 15
shipped — `packages/core/src/relations/` has the full resolver and
`includes.spec.ts` covers it in both core and the TypeORM adapter. Update
to describe the shipped state. Same sentence's "(Phase 13 swaps them)"
should be checked against Phase 13's actual status while you're there.

### D2 — The example app tells users includes don't work

Two sites, both user-visible:

- [main.ts:17](packages/examples/src/main.ts:17) — "relation includes
  remain a deferred feature", rendered into the **published Swagger
  description at `/docs`**.
- [owner.dtos.ts:32](packages/examples/src/owner/owner.dtos.ts:32) — "the
  field is absent from responses until a later phase populates it."

`packages/examples` is the Phase 17 reference application; its job is to
show the framework working. Verify `include=pets` actually populates
against the example before rewriting the text, then rewrite both.

### D3 — `STANDARD_OPERATIONS` describes a milestone that finished

[default-operation-registry.ts:55](packages/core/src/operations/default-operation-registry.ts:55):
"Enabled in the Milestone B skeleton; the rest activate in C." Milestone C
is complete and the `*Many` entries did **not** activate — bulk was
dropped. Line 71's "registered disabled **until bulk is built**" carries
the same assumption.

**Sequencing:** if Group C lands as Option 1 this text disappears entirely
— do D3 *after* C, or skip it.

### D4 — Sweep the remaining forward-looking phase references

Lower value, do last. Comments across core reference "Phase 13/14/15 will…"
in the future tense for phases that have shipped. These are not wrong the
way D1–D3 are — they read as provenance ("this exists because Phase 14")
rather than as forecasts. **Only rewrite the ones in the future tense**;
provenance references are useful and should stay.

---

## Group E — Guardrails

### E1 — Add a barrel-surface test

**Why:** ADR-0010 makes the core barrel a deliberate explicit list, and
Groups A and C both change it. Nothing currently detects an accidental
export addition or removal.

**What:** a test that snapshots the sorted export names of
`packages/core/src/index.ts`. Changing the public surface then requires
updating the snapshot — which is exactly the "on purpose" ADR-0010 asks
for.

**Do this after Group C**, so the snapshot records the intended end state
rather than a state you're about to change.

---

## Suggested order

Groups are independent unless noted. Within the plan, dependencies are:

```
A1 ──▶ A2, A5                     (helper first)
A3, A4                            (independent)
B1 ──▶ B3                         (comment describes end state)
B2 ──▶ B3
C1 ──▶ C2 ──▶ C3 ──▶ D3, E1       (decision gates the rest)
D1, D2, D4                        (independent, any time)
```

A sensible landing order: **A1 → A2 → A3 → A5 → A4 → D1 → D2 → B1 → B2 →
B3 → [C decision] → C2 → C3 → D3 → D4 → E1.**

That front-loads the steps with real defect-prevention value (A2 and A3
close silent-failure paths), gets the user-visible doc lies fixed early
(D1, D2), and defers the one group that needs a product decision.

## What this plan deliberately leaves alone

- The package topology, engine lifecycle, and registry design — all sound.
- The `default:` branches in `makeHandler`, `resolveInput`, and the two
  Swagger switches — they are the custom-operation seam, not oversights.
- `TransactionManager` — already documented as an intentional unimplemented
  seam by the previous plan.
- `Record<string, unknown>` in the merge, serializer, and bracket-parser
  internals — those are genuinely open-ended maps, not weakened enums.
- Test structure and naming — already consistent per package.
