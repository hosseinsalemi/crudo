# 13 — GraphQL Binding

`@kavo/graphql` (`packages/protocols/graphql`) builds a `GraphQLSchema`
over an existing `createCrud` service. Every resolver is a direct call
into the same `DefaultCrudService`/engine pipeline REST binds to — there
is no parallel request path, no second copy of filter/sort/pagination
validation, and no separate error handling. `@kavo/nest` (`packages/frameworks/nest`)
depends on `@kavo/graphql` to provide a ready-made Nest controller; the
package topology and the one-directional dependency this implies are
ADR-0016's subject — this doc covers what the binding actually does.

## 1. Package boundary

`@kavo/graphql` is host-framework-agnostic: it imports `@kavo/core` and
the `graphql` peer only, never `@kavo/nest` or any other framework
package (`graphql-only-imports-core` in `.dependency-cruiser.cjs`). It has
no idea Nest, Express, or any other host exists. This is what makes its
discovery helper (§4) reusable by a future host binding with zero changes
to `@kavo/graphql` itself.

## 2. Building one entity's schema

```ts
import { createCrudGraphQLSchema } from "@kavo/graphql";

const schema = createCrudGraphQLSchema({
  name: "Owner",
  service: ownerService, // whatever createCrud(Owner, ...) returned
  itemType: OwnerType, // hand-written GraphQLObjectType
  createInputType: CreateOwnerInput, // optional — omit to skip the mutation
  updateInputType: UpdateOwnerInput,
  patchInputType: PatchOwnerInput,
  deleteOne: true,
  restoreOne: true, // meaningful only if Owner declared soft delete
  purgeOne: true,
});
```

Every field this produces:

| Field                                       | Enabled by         |
| ------------------------------------------- | ------------------ |
| `Query.owner(id)`                           | always             |
| `Query.owners(limit, offset, sort, filter)` | always             |
| `Mutation.createOwner`                      | `createInputType`  |
| `Mutation.updateOwner`                      | `updateInputType`  |
| `Mutation.patchOwner`                       | `patchInputType`   |
| `Mutation.deleteOwner: Boolean`             | `deleteOne: true`  |
| `Mutation.restoreOwner: Owner`              | `restoreOne: true` |
| `Mutation.purgeOwner: Boolean`              | `purgeOne: true`   |

Each mutation is opt-in per entity — omit the option and the field never
reaches the schema. This does **not** read the entity's `OperationRegistry`
to check what REST actually has enabled: setting `restoreOne: true` here
for an entity whose `@Crud` config disables `restoreOne` still puts the
field in the schema, and it throws `OperationDisabledException` at resolve
time, the same way calling the REST route would. Keeping the two in sync
is the caller's job today — reading the registry directly is real,
scoped follow-up work (tracked as a GraphQL issue), not implemented here.

**Filter and sort** (`Query.<entity>s` args, always present):

- `sort: [String!]` — REST's own `-field` convention (`["-createdAt",
"name"]`), translated into `Sort[]` objects locally; this binding calls
  the programmatic `QueryContext` surface, which takes `Sort[]` directly,
  never REST's wire-string form.
- `filter: JSON` — a custom scalar (`GraphQLJSON`, built on graphql-js's
  own `valueFromASTUntyped`) carrying Kavo's raw filter AST directly:
  `{ kind: "condition", field, operator, value }` for a leaf, or `{ kind:
"group", operator: "AND"|"OR"|"NOT", children: [...] }` to combine.
  Operators are the AST's own `SCREAMING_SNAKE` spelling (`EQ`, `GTE`,
  `IN`, ...), not REST's camelCase wire tokens (`eq`, `gte`, `in`). This is
  the pragmatic version: a generated `<Entity>FilterInput` type per entity
  (real introspection, no raw AST in the schema) is schema-derivation work,
  scoped out for the same reason `itemType`/`createInputType` are still
  hand-written rather than derived from `EntityMetadata`.

## 3. Multiple entities on one schema

```ts
import { mergeCrudGraphQLSchemas } from "@kavo/graphql";

const schema = mergeCrudGraphQLSchemas([
  { name: "Owner", service: ownerService, itemType: OwnerType, createInputType: CreateOwnerInput },
  { name: "Cat", service: catService, itemType: CatType, createInputType: CreateCatInput },
]);
```

Field names are namespaced by each entity's own `name`, so entries never
collide. `mergeCrudGraphQLSchemas` throws `ConfigurationException` if the
result would have zero `Query` fields (an empty binding list) — an empty
`Query` type is invalid GraphQL, and graphql-js would otherwise only
report that on the first request, deep inside `graphql()`'s own schema
validation; this fails at schema-build time instead, with a message that
names the actual fix.

## 4. Registering types once, discovering everywhere

Hand-listing every entity at the call site (as in §3) works, but doesn't
scale past a couple of entities and needs updating every time one is
added. `registerCrudGraphQLTypes`/`getCrudGraphQLTypes` is a small,
process-wide registry — the GraphQL counterpart of `@kavo/nest`'s `@Crud`
registry — so an entity declares its GraphQL types once, next to its
DTOs:

```ts
// owner.graphql-types.ts
registerCrudGraphQLTypes(Owner, { itemType: OwnerType, createInputType: CreateOwnerInput });
```

`resolveCrudGraphQLSchema` (`discovery.ts`) is the host-agnostic pipeline
that ties this together: given a list of `{ entity }` refs and a
`resolveService(entity)` callback, it looks up each entity's registered
types, skips any entity with none (opt-in, not implied by `@Crud` alone),
and merges the rest. Two things are deliberately left to the caller,
supplied per host:

- **How to enumerate `@Crud` entities** — `@kavo/nest`'s
  `getCrudEntities()`, a plain array a future Express/Fastify/Next.js app
  builds by hand, or any other host's own registry.
- **How to resolve one entity's bound service** — `@kavo/nest`'s
  `ModuleRef` + `getCrudServiceToken`, a plain `Map`, or whatever DI
  container that host uses.

This is what makes the exact same `resolveCrudGraphQLSchema` call work
from `@kavo/nest`'s `BaseCrudGraphQLController` today and from a future
host binding without either package importing the other (ADR-0016).

## 5. The Nest binding

`@kavo/nest` (`packages/frameworks/nest/src/graphql/`) supplies the two
Nest-specific pieces `resolveCrudGraphQLSchema` needs and nothing else:

- **`BaseCrudGraphQLController`** (abstract): `onModuleInit` calls
  `resolveCrudGraphQLSchema(getCrudEntities(), (entity) =>
this.moduleRef.get(getCrudServiceToken(entity), { strict: false }))`
  and stores the result; `execute(query, variables)` runs one operation
  against it. A concrete controller adds `@Controller`/`@Post` and calls
  `execute`:

  ```ts
  @Controller("graphql")
  export class GraphQLController extends BaseCrudGraphQLController {
    // Nest reads constructor-injection metadata off the concrete class,
    // not an inherited one — this constructor must be declared even
    // though it only forwards to `super`.
    constructor(moduleRef: ModuleRef) {
      super(moduleRef);
    }

    @Post()
    @HttpCode(200) // GraphQL-over-HTTP convention: 200 even for a mutation
    handle(@Body() body: { query: string; variables?: Record<string, unknown> }) {
      return this.execute(body.query, body.variables);
    }
  }
  ```

- **`createDefaultGraphQLController(path)`** + `KavoModule`'s `graphql`
  option: the zero-code path. `KavoModule.forRoot({ infrastructure,
graphql: true })` mounts `POST /graphql`; `{ graphql: { path: "api/graphql"
} }` mounts it there instead. Setting `graphql` implies `provideServices`
  (the merged schema's resolvers need every entity's service as a DI
  provider to look up via `ModuleRef`), even if `provideServices` itself is
  left unset. A concrete controller (previous bullet) and this flag are
  alternatives — pick one per app, never both at the same path.

  `createDefaultGraphQLController` builds a **fresh class per call**, with
  real `@Controller`/`@Post`/`@HttpCode` decorator syntax closing over
  `path` — not a shared singleton, and not decorators applied as plain
  function calls after the class body. Both alternatives matter:
  a shared singleton would make two independently-configured `KavoModule`
  calls in one process (two apps, or two test files sharing a module
  cache) fight over one `@Controller` path metadata; and TypeScript's
  `emitDecoratorMetadata` only emits `design:paramtypes` for a class it
  sees an actual `@decorator` applied to at compile time — calling the
  same decorator function afterward compiles fine but silently drops the
  constructor's `ModuleRef` injection.

## 6. What's out of scope (by design, for now)

- Schema derivation from `EntityMetadata` — `itemType`/`createInputType`/etc.
  are hand-written per entity, the same status core's DTOs were before
  derivation existed for those.
- Registry-driven mutation exposure (§2) — this binding trusts the caller's
  `restoreOne: true`/etc. flags rather than cross-checking `OperationRegistry`.
- Relations/includes as GraphQL fields — only scalar `itemType` fields exist
  today; a relation would need to be hand-added to `itemType` with its own
  resolver.
- A typed `<Entity>FilterInput` per entity, instead of the raw-AST `JSON`
  scalar (§2).
- Bulk operations and subscriptions.

Each of these is real, valuable follow-up work, not an oversight — the
proof-of-concept status this package started at is still visible in what
it does _not_ attempt.
