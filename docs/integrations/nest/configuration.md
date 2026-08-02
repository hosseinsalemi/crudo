# Configuration

[Nest + TypeORM](/integrations/nest/typeorm), [Nest + Prisma](/integrations/nest/prisma), and [Nest + Mongoose](/integrations/nest/mongoose) cover the zero-config path. This page is the field-by-field reference for everything you can configure once zero-config isn't enough: every `@Kavo(Entity, config)` parameter, and every global setting your `KavoModule` can set.

## How config layers

Settings resolve through one precedence chain, each scope overriding the one before it:

```
built-in defaults → global (KavoModule) → entity (@Kavo config) → operation (operations.<id>) → per-call
```

A field you don't set at a given scope just falls through to the next one down. The full merge semantics (deep-merge rules, what "unset" means per field) are in [Configuration](/internals/architecture/08-configuration) — this page only documents what each field means and where you can set it.

## Global config (`KavoModule.forRoot` / `forRootAsync`)

```ts
KavoModule.forRootAsync({
  useFactory: () => ({
    infrastructure: createInfrastructure(dataSource),
    defaults: {/* KavoSettings, see below */},
    paginationStrategies: [],
  }),
  provideServices: true,
  graphql: true,
});
```

| Field                  | Type                                    | What it does                                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure`       | `KavoInfrastructure`                    | Where entity metadata and the repository adapter come from — `createInfrastructure(dataSource)` or `createInfrastructure(client, opts)`. Required for any `@Kavo` route to actually run.                                                                                         |
| `defaults`             | `DeepPartial<KavoSettings>`             | App-wide settings, one level below the built-in defaults and above every entity's own config. See **Settings fields** below for what's in `KavoSettings`.                                                                                                                        |
| `paginationStrategies` | `readonly PaginationStrategy[]`         | Registers custom pagination strategies beyond the built-in `"offset"`, so `pagination.strategy` can name one of these instead.                                                                                                                                                   |
| `useFactory`           | `(...args) => KavoModuleOptions`        | (`forRootAsync` only) Builds the options object, e.g. after awaiting `dataSource.initialize()`.                                                                                                                                                                                  |
| `inject`               | `readonly (string \| symbol \| Type)[]` | (`forRootAsync` only) DI tokens injected as `useFactory`'s arguments.                                                                                                                                                                                                            |
| `provideServices`      | `boolean`                               | Also provides `getKavoServiceToken(Entity)` as a real DI provider for every `@Kavo`-decorated class the process has seen — needed only if some other class constructor-injects a `@Kavo` entity's service directly.                                                              |
| `graphql`              | `boolean \| { path?: string }`          | Mounts a default GraphQL controller merging every entity that called `registerKavoGraphQLTypes` onto one schema. `true` mounts at `POST /graphql`; `{ path }` mounts elsewhere. Implies `provideServices`.                                                                       |
| `mcp`                  | `boolean \| { path?: string }`          | Mounts a default MCP controller (Streamable HTTP, stateless) exposing every `@Kavo` entity's full standard toolset — no per-entity opt-in. `true` mounts at `POST /mcp`; `{ path }` mounts elsewhere. Implies `provideServices`. Requires `@modelcontextprotocol/sdk` installed. |

## Settings fields (`KavoSettings`)

This is the shape of `defaults` above, and also of every entity-scope, operation-scope, and per-call override — the same schema at every scope, just merged in order.

### `pagination`

| Field          | Type                            | Default    | What it does                                                                                        |
| -------------- | ------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `defaultLimit` | `number`                        | `20`       | Page size when a request supplies no `limit`.                                                       |
| `maxLimit`     | `number`                        | `100`      | Hard ceiling on `limit` — a request asking for more is clamped, not rejected.                       |
| `strategy`     | `"offset"` \| a registered name | `"offset"` | Which pagination strategy computes the page — see `paginationStrategies` above for adding your own. |
| `count`        | `boolean`                       | `true`     | Whether list responses compute `total` (an extra `COUNT` query per list call).                      |

### `query`

| Field            | Type              | Default | What it does                                                                                                                                                                                                        |
| ---------------- | ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxFilterDepth` | `number`          | `3`     | Max nesting depth of the `filter` AST (`and`/`or` groups nested inside each other).                                                                                                                                 |
| `maxInValues`    | `number`          | `100`   | Max array length for `in`, `notIn`, and `between` filter operators.                                                                                                                                                 |
| `defaultSort`    | `readonly Sort[]` | `[]`    | Sort order applied when a request supplies no `sort` of its own. A client-supplied `sort` always wins outright — it never merges with this. Validated against the sortable allowlist, same as client-supplied sort. |

### `errors`

| Field             | Type      | Default | What it does                                                                                                                             |
| ----------------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `exposeInternals` | `boolean` | `false` | Whether driver-level error details (raw SQL error messages, stack info) leak into problem-details responses. Keep `false` in production. |

### `relations`

| Field              | Type                                             | Default | What it does                                                                                                                                                        |
| ------------------ | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxIncludeDepth`  | `number`                                         | `2`     | Max nesting depth for `include=` chains (`include=owner.tags` is depth 2).                                                                                          |
| `maxIncludedNodes` | `number`                                         | `10`    | Max total number of included relation nodes per request, across every branch of the include tree.                                                                   |
| `edges`            | `Readonly<Record<string, RelationEdgeSettings>>` | `{}`    | Per-relation permissions, keyed by relation property name — see **`relations.edges`** below. Inclusion is opt-in: a relation absent here cannot be included at all. |

**`relations.edges.<name>`** (`RelationEdgeSettings`):

| Field            | Type                              | Default                                | What it does                                                                                                                                                              |
| ---------------- | --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `includable`     | `boolean`                         | `false`                                | Whether clients may `include=` this relation at all.                                                                                                                      |
| `defaultInclude` | `boolean`                         | `false`                                | Include this relation even when the client doesn't ask for it.                                                                                                            |
| `maxDepth`       | `number`                          | (inherits `relations.maxIncludeDepth`) | Overrides the include-depth limit for the subtree below this relation only.                                                                                               |
| `strategy`       | `"join"` \| `"batch"` \| `"auto"` | `"auto"`                               | How the relation loads: `join` (single query, correct for to-one), `batch` (per-level `WHERE parentId IN (...)`, correct for to-many), or `auto` (picks per cardinality). |

### `softDelete`

| Field      | Type                             | Default       | What it does                                                                                                                                                                                                                               |
| ---------- | -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `field`    | `string`                         | `"deletedAt"` | Name of the delete-marker column.                                                                                                                                                                                                          |
| `strategy` | `"auto"` \| `"soft"` \| `"hard"` | `"auto"`      | `auto` resolves per entity (soft if the marker field exists, hard otherwise); `soft`/`hard` state it outright. `false` for the whole `softDelete` key (instead of an object) disables soft delete entirely, even if a marker field exists. |

See [Getting started's soft delete section](/getting-started#soft-delete) for the practical walkthrough, and [Soft delete, restore & purge](/internals/architecture/11-soft-delete) for the full behavior.

### `operations` (global scope only)

At global scope, `operations` is a flat map of booleans, keyed by standard operation id — coarser than the richer per-entity form below:

```ts
defaults: {
  operations: { restoreOne: false },
}
```

| Operation id | Enabled by default                                          |
| ------------ | ----------------------------------------------------------- |
| `createOne`  | Yes                                                         |
| `findOne`    | Yes                                                         |
| `findMany`   | Yes                                                         |
| `updateOne`  | Yes                                                         |
| `patchOne`   | Yes                                                         |
| `deleteOne`  | Yes                                                         |
| `restoreOne` | No, unless soft delete is declared on the entity (ADR-0013) |
| `purgeOne`   | No, until named explicitly                                  |

An entity's own `operations.<id>` (below) always wins over this global map.

## `@Kavo(Entity, config)` — entity-scope config

Every field above (`pagination`, `query`, `errors`, `relations`, `softDelete`) can also be set here, one level above global. In addition, `@Kavo`'s config carries three fields that only make sense per entity:

### `dto`

Registers DTO classes per slot — every slot is independently optional and falls back to an entity-derived default when omitted:

```ts
@Kavo(Book, {
  dto: {
    create: CreateBookDto,
    update: UpdateBookDto,
    item: BookItemDto,
    list: BookListDto,
  },
})
```

| Slot     | Default when omitted                                |
| -------- | --------------------------------------------------- |
| `create` | Entity's own shape, minus generated/relation fields |
| `update` | Same default as `create`                            |
| `patch`  | `Partial<update>` if set, else `Partial<Entity>`    |
| `query`  | Generic `QueryContext<Entity>`                      |
| `item`   | Entity, subject to field selection                  |
| `list`   | Same as `item`'s resolved type                      |

There's no `patch` DTO class to write on its own — it derives from `update`. See [DTO system](/internals/architecture/04-dto-system) for full derivation rules.

### `allowlists`

What a request may filter, sort, and select on — including relation paths. Anything outside an allowlist is rejected with a 400, never silently dropped:

```ts
@Kavo(Book, {
  allowlists: {
    filterable: ["id", "title", "author"],
    sortable: ["id", "title"],
    selectable: ["id", "title", "author"],
  },
})
```

| Field        | Type                                                          | What it does                    |
| ------------ | ------------------------------------------------------------- | ------------------------------- |
| `filterable` | `readonly FieldPath[]` \| `{ exclude: readonly FieldPath[] }` | Fields usable in `filter[...]`. |
| `sortable`   | same shape                                                    | Fields usable in `sort=`.       |
| `selectable` | same shape                                                    | Fields usable in `fields=`.     |

`{ exclude: [...] }` means "every own column except these", resolved against entity metadata at bootstrap. Omit a key entirely and it derives from the `query` DTO or entity metadata instead.

### `operations`

Per-operation overrides, keyed by standard operation id. Each entry is either a boolean shorthand or a full `OperationConfig` object:

```ts
@Kavo(Book, {
  operations: {
    patchOne: false, // shorthand: disable outright
    restoreOne: { enabled: true, meta: { routes: { path: ":id/undelete" } } },
  },
})
```

| Field                | Type                                | What it does                                                                                                                                  |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `boolean`                           | Turns the operation on or off explicitly — the long form of the `true`/`false` shorthand, for when the entry also carries settings or `meta`. |
| `handler`            | `OperationHandler<Entity>`          | Replacement handler function, keeping the default DTO/serialization scaffolding around it.                                                    |
| `meta`               | `OperationMetadata`                 | Opaque bag consumed by the framework layer — in `@kavo/nest`, this is `{ routes: KavoRouteOptions }`.                                         |
| _(any settings key)_ | same shape as global `KavoSettings` | Overrides that apply to this operation only, one level above the entity's own settings.                                                       |

**`operations.<id>.meta.routes`** (`@kavo/nest`'s `KavoRouteOptions`):

| Field           | Type                                                      | Default                                     | What it does                                                                                                               |
| --------------- | --------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `method`        | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | the operation's standard verb               | Overrides which HTTP verb the generated route uses.                                                                        |
| `path`          | `string`                                                  | the operation's standard path               | Route path relative to the controller (e.g. `":id/activate"`).                                                             |
| `enabled`       | `boolean`                                                 | `true`                                      | `false` makes the operation service-only: still callable through `service.engine.execute(...)`, but no route is generated. |
| `successStatus` | `number`                                                  | `201` create, `204` delete, `200` otherwise | Overrides the response status code on success.                                                                             |

See [NestJS integration](/internals/architecture/10-nestjs-integration) for how route generation reads this, and [Registry-driven operations](/internals/adr/0006-registry-driven-operations) for why routes always come from the same registry the engine uses.
