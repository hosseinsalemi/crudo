# 12 — Relation System & Nested Includes (Phase 15)

`GET /owners?include=pets&fields[pets]=id,name` — everything between that
query string and the SQL is this phase.

```ts
@Crud(Owner, {
  relations: { edges: { pets: { includable: true } } },
})
```

Inclusion is an **allowlist**, exactly like filtering and sorting: ORM
metadata supplies the shape of a relation (name, target, cardinality) and
config supplies permission, which metadata can never know. A relation
nobody opted in is a 400, never a silent omission.

## 1. The registry

`DefaultRelationRegistry` merges the two sources at bootstrap into one
`RelationDescriptor` per edge:

| Key                             | Source   | Default                              |
| ------------------------------- | -------- | ------------------------------------ |
| `name`, `target`, `cardinality` | metadata | —                                    |
| `includable`                    | config   | `false` — naming the edge opts it in |
| `defaultInclude`                | config   | `false`                              |
| `maxDepth`                      | config   | inherit `relations.maxIncludeDepth`  |
| `strategy`                      | config   | `auto`                               |

An edge naming a relation the entity does not have is a bootstrap
`ConfigurationException`: an allowlist typo that silently permits nothing
looks exactly like working config until the first client asks.

## 2. Resolution (`DefaultIncludeResolver`)

1. **Parse** dot-paths into a tree; overlapping paths merge, so `posts`
   and `posts.comments` produce one `posts` node with a `comments` child.
2. **Validate** each edge against the registry of the entity that _owns_
   it — unknown or non-includable → `KAVO_QUERY_INVALID_FIELD` (400).
3. **Limit**: `relations.maxIncludeDepth` (default 2) as a budget spent
   per level, a relation's own `maxDepth` replacing that budget for its
   subtree, and `relations.maxIncludedNodes` (default 10) across the whole
   tree → `KAVO_QUERY_LIMIT_EXCEEDED`.
4. **Cycle guard is depth, and only depth.** `manager.manager.manager` is
   legal until the budget runs out. Visited-type tracking would forbid a
   legitimate self-relation, and depth is the rule a client can predict.
5. **Fieldsets**: `fields[posts.comments]=id,body` attaches to that node,
   validated against the _target_ entity's selectable allowlist.
6. **Resolve decisions**: `auto` becomes `join` or `batch`, and the
   target's delete strategy is attached — so the adapter translates
   answers rather than re-deriving them.

Every issue across the tree is collected before throwing: one round trip,
all problems, like the rest of the query pipeline.

Nested levels read the **target entity's own resolved config** through the
`EntityCatalog` — its allowlists, DTOs, delete strategy, and further
relations. That is the mechanism behind the rule that _a relation never
widens what its target exposes_. Lookup is per-request, not a bootstrap
snapshot, because `createCrud(Owner)` may run before `createCrud(Pet)` and
neither order should change what `include=pets` does. A target that never
went through `createCrud` is derived from metadata alone: readable, but
opening no further relations, since nothing opted in.

## 3. Loading strategies

| Strategy | What happens                                                                  | Default for |
| -------- | ----------------------------------------------------------------------------- | ----------- |
| `join`   | `leftJoinAndSelect` in the main query                                         | to-one      |
| `batch`  | one extra query per relation level, parents batched by id, stitched in memory | to-many     |
| `auto`   | the two rules above                                                           | everything  |

**Pagination correctness (normative): root pagination always counts and
slices distinct root entities, never joined rows.** Batching to-many
relations is what makes that free — the main query never multiplies its
rows. When a to-many is _explicitly_ joined anyway, the fallback holds the
line: TypeORM's `skip`/`take` paginate root ids in a subquery first, and
`count` is a dedicated query with no include joins at all. A page of one
blog is one blog with all of its articles, never half a blog.

In `@kavo/typeorm`, join aliases are deterministic (`Owner__pets__owner`)
and share `FilterTranslator`'s scheme, so `filter[blog.name][eq]=…`
alongside `include=blog` reuses the one selecting join instead of adding a
second, non-selecting one under a duplicate alias.

**Eager loading for detail views.** `strategy: "join"` is not restricted to
to-one edges — forcing it onto a to-many edge folds that relation into the
main query too, so `findOne`/`findOneById` resolves in a single round trip
instead of the main query plus one batch query per relation level. This is
the pattern for a detail endpoint over a relation with modest cardinality
(an owner's pets, a blog's articles), where the extra joined rows are cheap
and a second query is pure overhead:

```ts
joinedBlogs = kavo.createCrud(Blog, {
  relations: { edges: { articles: { includable: true, strategy: "join" } } },
});
```

It is opt-in per edge, never the default — `auto` still resolves a to-many
to `batch`, and a list endpoint over the same relation should keep it that
way: joining a large to-many into a paginated main query is correct (the
skip/take-on-distinct-roots fallback above holds) but wastes bandwidth on
rows the batch strategy would fetch once per page instead of once per root.
Because `strategy` is entity-wide config, not per-operation, giving a detail
route eager loading while a list route keeps batching means two `createCrud`
registrations of the same entity — one per route, each with its own
strategy — exactly as `blogs` and `joinedBlogs` do in
`packages/orms/typeorm/tests/includes.spec.ts`.

A many-to-many edge is nothing special here: metadata maps
`isManyToMany` to cardinality `"many"` exactly like `isOneToMany`, so it
gets the same `batch` default and the same distinct-roots pagination
guarantee — the join table never reaches the main query. `Pet.tags` (the
example app) is what first exercises this path; no adapter or core change
was needed to support it.

`Owner.address` (`@OneToOne`, owning side on `Owner`) is the example app's
one-to-one relation: cardinality falls out of the metadata adapter's
existing `isOneToMany || isManyToMany ? "many" : "one"` rule with no special
case, and `auto` resolves it to `join` exactly like `Pet.owner`.

## 4. Interplay

- **Sparse fieldsets:** keys needed for stitching are always fetched and
  stripped at serialization — "kept internally, stripped late". Root
  `fields=` selects the root's own columns; relation shapes are selected
  through `fields[<path>]`.
- **DTOs:** an included node is projected through the target's registered
  `item` DTO (`list` for a to-many, which falls back to `item`), else the
  target's derived default. A relation key on the _parent's_ DTO is
  documentation, not a load: it stays absent until the node is included.
- **Soft delete (Phase 14):** soft-deleted related rows are excluded from
  includes. Root-level `withDeleted` applies to the **root only** — the
  adapter spells the child predicate out rather than leaving it to the
  ORM's default, so widening the root never silently widens the relation.
  A per-include `withDeleted` is deliberately out of scope in v6.
- **`findOne` supports `include`** with identical semantics.
- **Swagger:** `include` and one `fields[<relation>]` per includable
  relation are documented from the entity config's allowlist — the only
  relation knowledge decoration time has (ADR-0012).

## 5. Writes

Association by id, never deep nested writes — the rationale and the
extension point are **ADR-0014**. `{"owner": 7}`, `{"owner": {"id": 7}}`,
`{"tags": [1, {"id": 2}]}`, and `null` all work; anything more inside a
relation object is narrowed to the id rather than half-honored.

## 6. Not included

Filtering or sorting _on_ an included node's rows (`include=posts` where
only published posts come back) is not v6: `filter` restricts root rows,
and an included node returns the target's rows as they are. The seam for
it is the include node, which already carries per-node state.
