# 10 — NestJS Integration (Phases 11–12)

`@kavo/nest` turns one decorator into a full CRUD controller:

```ts
@Crud(UserEntity)
@Controller("users")
export class UserController {}
```

`@nestjs/common`/`core` are peerDependencies; `@nestjs/swagger` is an
optional peer. The package never imports an ORM adapter (Phase 2
boundary) — infrastructure arrives through DI.

## 1. Module design

- **`KavoModule.forRoot(options)`** (global): creates the Kavo root
  instance (`createKavo` skin — `defaults` passes through untouched),
  registers the problem-details exception filter app-wide (`APP_FILTER`),
  and exposes `KAVO_INSTANCE`. **`forRootAsync`** resolves the options
  via `useFactory`/`inject` — the checkpoint app uses it to wait for the
  `DataSource` before building `createTypeOrmInfrastructure(dataSource)`.
- **`KavoModule.forFeature(controllers)`**: for each `@Crud`-decorated
  controller, registers the controller and provides the entity's service
  under `getCrudServiceToken(Entity)` (factory:
  `kavo.createCrud(entity, config)` — bootstrap happens here, once).
  A non-`@Crud` class fails fast with a `ConfigurationException`.

**Singleton services, deliberately:** the engine threads every
per-request concern (principal, transaction, query, correlation id,
state) through `CrudContext`, so request-scoped providers would buy
nothing and cost per-request instantiation of the whole graph.

## 2. Route generation (registry-driven, decoration-time)

The decorator builds the entity's operation registry with the same
`createOperationRegistry` the engine uses and generates a route per
**enabled** entry (ADR-0006, ADR-0012):

| Operation    | Route                | Status |
| ------------ | -------------------- | ------ |
| `createOne`  | `POST /`             | 201    |
| `findMany`   | `GET /`              | 200    |
| `findOne`    | `GET /:id`           | 200    |
| `updateOne`  | `PUT /:id`           | 200    |
| `patchOne`   | `PATCH /:id`         | 200    |
| `deleteOne`  | `DELETE /:id`        | 204    |
| `restoreOne` | `PATCH /:id/restore` | 200    |
| `purgeOne`   | `DELETE /:id/purge`  | 204    |

Disabled entries (config `operations.<id>: false`, or a default-off
entry) get **no route**. Any entry's route shape is overridable through
its own `meta.routes` (`method`, `path`, `successStatus`);
`meta.routes.enabled: false` keeps it service-only. Because generation
walks the registry, Phase 14's restore/purge appeared by _enabling
entries_ — this generator did not change. Their enablement is
config-declared rather than metadata-driven, precisely because
decoration time has no ORM metadata (ADR-0013): `softDelete: { strategy:
"soft" }` adds the restore route, `operations: { purgeOne: true }` the
purge route.

**Manual-method-wins:** a hand-written controller method whose name
matches an operation id suppresses that generated route — detected via
`hasOwnProperty` on the prototype, no config needed.

**`@Override(operationId?)`** (issue #23) is the additive middle path
between a config-level `operations.<id>.handler` override and plain
manual-method-wins: the decorated method still gets the registry's route
— method, path, status, `@Param`/`@Query`/`@Body`, and Swagger metadata,
identical to what a generated route would carry — only the function
backing it is the decorated method itself, not `makeHandler`'s generated
one. `operationId` defaults to the method's own name, the same inference
manual-method-wins already uses. Resolution order in the `@Crud` loop is
override map → manual-method-wins → generate, so a decorated method never
falls through to plain name-matching.

The mechanism needs no core change: `defineRoute`'s two jobs — installing
a generated function, then applying Nest's real method/param/status
decorators to whatever sits at that property — split into an
`applyRouteDecorators` step shared by both paths. For an override, Kavo
skips installing a function and applies that same step to the existing,
hand-written method; Nest dispatches to it directly at request time, with
no engine or `CrudEngine` involvement in the indirection.

The decorated method typically injects the entity's bound
`DefaultCrudService` via the existing `getCrudServiceToken` (ordinary
constructor DI on the controller) to delegate to default behavior
(`this.base.createOne(dto)`), the same "base" pattern config-level
overrides get through `context` inside a plain `OperationHandler`.

Because Kavo owns the param wiring, the decorated method must accept
parameters in the same fixed position a generated route would — reads:
`(id?, query)`; writes: `(id?, body)` — and must not declare its own
`@Param`/`@Query`/`@Body`: `@Crud` checks for existing Nest route-argument
metadata on the method and fails at decoration time (ADR-0012's only
moment) rather than let the two decorations collide silently. The same
fail-fast rule covers a duplicate override target (two methods claiming
one operation id) and an override naming an operation id that is absent
or disabled in the registry — a silent no-op override is a footgun.

**A read override's `query` parameter arrives already wrapped in
`WireQuery`** (issue #25) — `applyParamDecorators` is the single call site
that decides a read operation's `@Query()` decorator, shared by a
generated route and an `@Override`'d method alike, and it applies
`Query(new WireQueryPipe())` rather than a bare `Query()`. Nest's pipe
runs before either a generated handler or a hand-written override method
body executes, so both receive the identical normalized value — an
override does not need to (and should not) call `flattenQuery`/`WireQuery`
itself:

```ts
@Override()
async findOne(id: EntityId, query: WireQuery) {
  return this.base.findOne(id, query);
}
```

`flattenQuery`/`WireQuery` stay exported from `@kavo/nest`/`@kavo/core` for
the rare caller wiring a query param manually outside this fixed position;
the common case needs neither.

**Fully custom, registry-independent routes** (issue #26) are a separate,
simpler path that needs no `@Crud` involvement at all — the only way to
add an action with no operation identity of its own, since `EntityConfig`
has no surface for registering a new operation id. The decoration-time
loop only visits methods two ways: manual-method-wins (name matches a
registry operation id) and the `@Override` map (name registered via
`@Override`). A method matching neither — carrying its own native
`@Get`/`@Post`/etc. decorator and its own `@Param`/`@Query`/`@Body` — is
never inspected by `@Crud`; it is an ordinary Nest controller method that
happens to live on a `@Crud`-decorated class. The only Kavo-specific
piece it typically wants is the entity's bound service, reachable the
same way an `@Override`'d method reaches it — ordinary constructor DI via
`getCrudServiceToken(Entity)`:

```ts
@Controller("users")
@Crud(User)
export class UserController {
  constructor(@Inject(getCrudServiceToken(User)) private readonly base: DefaultCrudService<User>) {}

  @Get(":id/summary")
  async summary(@Param("id") id: string): Promise<unknown> {
    const user = await this.base.findOne(id as never);
    return { headline: `${user.name} <${user.email}>` };
  }
}
```

This is the same "base" delegation pattern `@Override` and config-level
handlers use, without any of the registry machinery around it: no
generated method/path/status from config, no `@Override`-supplied
Swagger metadata, no automatic param wiring — the method owns all of
that itself, exactly as it would on a plain Nest controller with no
`@Crud` in the picture. Reach for `@Override` when the action is one of
the standard operations and should keep getting its route/Swagger/param
metadata generated from config while only its implementation changes;
reach for a plain native-decorated method for anything else — an action
with no operation identity of its own needs none of that generated
machinery. `packages/examples/src/address/address.controller.ts`'s
`normalizePostalCode` and `validatePostalCode` both take the plain
native-decorated path.

Mechanically, generated methods are defined on the prototype and
decorated by _calling_ Nest's own decorators (`Post(path)(proto, name,
descriptor)`, `Param("id")(…)`, …) — identical metadata to hand-written
syntax, so guards, interceptors, versioning, and prefixes compose
normally. The service arrives by property injection under a private key;
`WireQueryPipe` (internal to `@kavo/nest`) wraps `req.query` in core's
`WireQuery`, after `flattenQuery` normalizes qs-extended nested objects
back to flat bracket keys, making the binding query-parser-agnostic.

## 3. Exception mapping

`KavoExceptionFilter` (`@Catch(KavoException)`) is the one boundary
between Kavo's hierarchy and HTTP: catalog status +
`application/problem+json` body via `toProblemDetails`, honoring
`errors.exposeInternals`. Kavo exceptions never extend Nest's.

## 4. Swagger integration

Optional and zero-cost when absent (`createRequire` probe, cached).
When `@nestjs/swagger` is installed, generated routes get: operation ids
(`User_findMany`), the `:id` param, the Phase 5 query params documented
on list routes, registered DTO classes as body schemas (`ApiBody`), and
problem-details response schemas for 400/404. Allowlist-derived
per-field query documentation needs ORM metadata, which doesn't exist at
decoration time — revisited in Phase 16's DX pass.

## 5. Testing

`tests/binding.e2e.spec.ts` runs a real Nest app over an in-memory fake
infrastructure (no ORM in this package): all six routes, envelope shape,
grammar wiring, problem-details mapping, disabled operations,
manual-method-wins, custom + service-only operations, the service token,
the soft-delete routes (Phase 14), relation includes (Phase 15), and the
Swagger body/hint schemas. The full-stack path (Nest → engine → TypeORM → SQLite) is the
checkpoint app's suite in `packages/examples`.
