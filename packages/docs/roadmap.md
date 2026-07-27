# Roadmap — remaining work

Kavo was built from a phased build plan (`kavo-phases-v6.md`, retired once
Milestone C landed). Milestones A–C are done and their design is documented
for real in [`architecture/`](architecture/) and [`adr/`](adr/) — those are now
the authoritative sources, not a plan document.

What the plan still held that the code and docs do not is **Milestone D**: the
three bodies of work below, none of which has been started. Phase numbers are
kept because the architecture docs, ADRs and commit history already refer to
them.

| Milestone            | Phases | State                                                                                                                                       |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Blueprint        | 1–3    | Done — architecture, monorepo, contracts.                                                                                                   |
| B — Walking skeleton | 4–12   | Done — end-to-end CRUD through TypeORM behind generated Nest routes, with filtering/sorting/pagination, layered config, problem details.    |
| C — Core features    | 13–15  | Done — operation control, soft delete/restore/purge, nested relation includes. (The optional batch/bulk surface was dropped, not deferred.) |
| **D — Ship**         | 16–18  | **Not started** — the work below.                                                                                                           |

---

## Phase 16 — Developer experience API

**Depends on:** the configuration system, the Nest integration, and the whole
Milestone C feature set.

**Shape the public surface has to support, with zero manual generic arguments:**

```ts
const userCrud = createCrud(UserEntity); // zero-config, implicit defaults

const kavo = createKavo({ defaults: { pagination: { maxLimit: 50 } } });
const userCrud = kavo.createCrud(UserEntity, {
  dto: { item: UserItemDto, list: UserListDto },
});

const { items, total, limit, offset } = await userCrud.findMany({
  include: ["posts.comments"],
  fields: { posts: ["id", "title"] },
});

await userCrud.deleteOne(id); // soft delete, if UserEntity is SoftDeletable
await userCrud.restoreOne(id);

@Module({ imports: [KavoModule.forFeature([UserEntity])] })
export class UserModule {}
```

**Deliverables**

1. Public API reference: the registration APIs and the fluent/builder surface.
2. Side-by-side usage examples — zero-config vs. partial vs. fully configured
   (global + entity + overridden operations).
3. Migration guide from bare `createCrud(Entity)` to a fully configured setup.
4. **Type-inference acceptance tests** (`expectTypeOf`/tsd) run in CI: include
   paths, DTO slots and envelope fields must infer correctly in the examples
   above with no manual generics. This is the DX contract.
5. **Error-message quality pass** over the likeliest developer mistakes —
   unknown include path, non-allowlisted filter field, disabled operation call,
   missing adapter registration — each error must name the fix.
6. A naming-consistency audit of the whole public surface against the naming
   conventions in `CLAUDE.md` and [`glossary.md`](glossary.md). This is the last
   cheap moment to rename anything.

**Constraint:** the zero-config path stays genuinely zero-config. Everything
here is additive, never a tax on the simple case.

---

## Phase 17 — Reference application

**Depends on:** the Nest integration and Phase 16; exercises everything.

**Goal:** one realistic application in `packages/examples/` that uses every
shipped feature — living documentation and the `@kavo/nest` e2e bed at once,
grown from the existing example app.

**Domain** (chosen to force the features): a project-management API — `User`,
`Project`, `Task`, `Comment`, `Tag`. It must exercise nested includes ≥ 2 deep
(`project.tasks.comments`), sparse fieldsets on includes, relation-path
filtering, soft delete + restore on `Task`, a fully custom, registry-independent
route (`POST /tasks/:id/complete`, issue #26), and global config with
per-entity overrides.

**Deliverables**

1. The app, runnable with one command against a containerized DB, seeded.
2. An e2e suite over its generated routes.
3. A feature-coverage matrix: every headline feature → where the app exercises
   it. Gaps in that matrix are undone work.

**Constraints:** the app consumes public APIs only — if it needs a deep import,
that is an API-surface bug. No feature is demonstrated in pseudo-code; it runs
or it is not in the app.

---

## Phase 18 — npm publishing & release engineering

**Depends on:** effectively everything. This is the shipping phase.

**Goal:** ship `@kavo/core`, `@kavo/typeorm` and `@kavo/nest` to npm in a way
that stays maintainable, not just one publishable release.

**Deliverables**

1. **Build output:** dual ESM + CJS per package, correct `exports` map, shipped
   `.d.ts`. Address the dual-package pitfalls explicitly — default-export
   interop, and `instanceof` across module instances, which matters for the
   exception hierarchy. Confirm tree-shakability for `@kavo/core`-only
   consumers.
2. **Dependency classification:** `typeorm` and `@nestjs/*` as peer
   dependencies of their own adapter packages, never of `@kavo/core`; regular
   dependencies minimal everywhere; supported Node and peer ranges stated and
   CI-tested as a matrix.
3. **API-surface gating:** api-extractor (or equivalent) produces a public API
   report per package, and an unapproved report diff fails CI — the barrel
   changes only on purpose (ADR-0010).
4. **Versioning & release automation:** changesets, with publish order derived
   from the package graph (core → typeorm → nest) so a core-breaking change
   cannot ship ahead of its dependents; a `next` prerelease channel.
5. **Provenance & supply chain:** npm provenance/attestation on publish,
   lockfile-based CI installs, dependency audit as a release gate.
6. **Semver & deprecation policy:** state what counts as breaking — adding a
   required method to `RepositoryAdapter`, renaming an error code, changing a
   config default — and the pre-1.0 vs. post-1.0 stability commitments. Shipping
   `0.x` first is fine so real feedback arrives before the surface hardens.
7. **Docs generation:** API reference generated from the core contracts (e.g.
   TypeDoc) published alongside the query-grammar document per release, so
   reference and grammar never drift from the shipped types.

**Constraint:** no manual publish steps for routine releases — the pipeline is
the only path to npm.
