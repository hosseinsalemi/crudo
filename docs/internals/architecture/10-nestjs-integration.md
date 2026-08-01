# 10 — NestJS Integration

`@kavo/nest` turns one decorator into a full CRUD controller:

```ts
@Kavo(UserEntity)
@Controller("users")
export class UserController {}
```

`@nestjs/common`/`core` are peerDependencies; `@nestjs/swagger` is an
optional peer. The package never imports an ORM adapter (ADR-0002
boundary) — infrastructure arrives through DI.

## 1. Module design

- **`KavoModule.forRoot(options)`** (global): creates the Kavo root
  instance (`createKavo` skin — `defaults` passes through untouched),
  registers the problem-details exception filter app-wide (`APP_FILTER`),
  exposes `KAVO_INSTANCE`, and registers `KavoBinder`. **`forRootAsync`**
  resolves the options via `useFactory`/`inject` — the checkpoint app uses
  it to wait for the `DataSource` before building
  `createTypeOrmInfrastructure(dataSource)`.
- **`KavoBinder`** (`onModuleInit`, internal): uses `@nestjs/core`'s
  `DiscoveryService` to find every `@Kavo`-decorated controller already in
  the app's module graph and assigns `kavo.createCrud(entity, config)`
  directly onto `this[KAVO_SERVICE_PROPERTY]` — bootstrap happens here,
  once per controller. This is what makes a plain Nest `controllers:` array
  (in `AppModule` or anywhere else) sufficient on its own; no explicit
  per-entity registration is needed for the generated route methods, which
  only read that property at request time, well after `onModuleInit`.
- **`KavoModule.forFeature(controllers)`**: registers the controllers
  (redundant if they're already in some module's `controllers:` array) and
  additionally provides the entity's service under
  `getKavoServiceToken(Entity)` as a real DI provider. Reach for this only
  when some class needs to constructor-inject that token itself — a
  resolution that happens at instantiation time, before `onModuleInit` has
  run, so it can't rely on the binder. A non-`@Kavo` class fails fast with
  a `ConfigurationException`. Inside a `@Kavo`-decorated class itself,
  prefer `boundKavoService(this)` over constructor injection — the binder
  has already bound it by the time any request arrives.
- **`KavoModule.forFeature()`** (no arguments): the same DI-provider half
  of `forFeature`, but for every `@Kavo`-decorated class the process has
  seen so far, read from the decoration-time registry `@Kavo` itself
  populates — no controller list, and no `controllers:` field in the
  returned module (the caller already put them in an ordinary Nest
  `controllers:` array). This is what lets a normal app get constructor
  injection everywhere with one stable call that needs no updates as
  controllers are added or removed. Fails fast if two different
  controllers registered the same entity — the provider token is
  per-entity, so which config would win is otherwise silently ambiguous.
  Scoped to the whole process rather than one app's module graph, which is
  exactly why `@kavo/nest`'s own tests — many differently-configured
  `@Kavo(Todo, ...)` classes declared across one file's test modules —
  always pass `forFeature` an explicit array instead.
- **`{ provideServices: true }`** on `forRoot`/`forRootAsync` folds the
  no-argument `forFeature()` in directly — the same providers, merged into
  the same call — so a normal app states its Kavo config once instead of
  importing both `forRootAsync({...})` and a separate `forFeature()`.

**Singleton services, deliberately:** the engine threads every
per-request concern (principal, transaction, query, correlation id,
state) through `KavoContext`, so request-scoped providers would buy
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
walks the registry, soft delete's restore/purge appeared by _enabling
entries_ — this generator did not change. Their enablement is
config-declared rather than metadata-driven, precisely because
decoration time has no ORM metadata (ADR-0013): `softDelete: { strategy:
"soft" }` adds the restore route, `operations: { purgeOne: true }` the
purge route.

**Global `defaults.operations.<id>` (issue #38, ADR-0015) is not seen
here.** `KavoModule.forRootAsync`'s `defaults` resolves only once its
factory runs, which is always _after_ `@Kavo` has already decorated
every controller and generated its routes (ADR-0012) — there is no
value to read yet at the moment this table's decision is made. A route
an entity doesn't disable itself therefore still generates, even under
a global `operations.<id>: false`. The bound service _does_ see the
global default (it's resolved through `createKavo`'s `createCrud`,
which runs at `onModuleInit`), so calling that route always answers
`405` with `code: "KAVO_OPERATION_DISABLED"` — never a silent success,
and never a bare `404` that would suggest the route was never mapped.
An app that wants the route itself gone still states so per entity,
exactly as before.

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
manual-method-wins already uses. Resolution order in the `@Kavo` loop is
override map → manual-method-wins → generate, so a decorated method never
falls through to plain name-matching.

The mechanism needs no core change: `defineRoute`'s two jobs — installing
a generated function, then applying Nest's real method/param/status
decorators to whatever sits at that property — split into an
`applyRouteDecorators` step shared by both paths. For an override, Kavo
skips installing a function and applies that same step to the existing,
hand-written method; Nest dispatches to it directly at request time, with
no engine or `KavoEngine` involvement in the indirection.

The decorated method typically delegates to default behavior via the
entity's bound `DefaultKavoService`, reachable as `boundKavoService(this)`
(`this.base.createOne(dto)`), the same "base" pattern config-level
overrides get through `context` inside a plain `OperationHandler`.

Because Kavo owns the param wiring, the decorated method must accept
parameters in the same fixed position a generated route would — reads:
`(id?, query)`; writes: `(id?, body)` — and must not declare its own
`@Param`/`@Query`/`@Body`: `@Kavo` checks for existing Nest route-argument
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
simpler path that needs no `@Kavo` involvement at all — the only way to
add an action with no operation identity of its own, since `EntityConfig`
has no surface for registering a new operation id. The decoration-time
loop only visits methods two ways: manual-method-wins (name matches a
registry operation id) and the `@Override` map (name registered via
`@Override`). A method matching neither — carrying its own native
`@Get`/`@Post`/etc. decorator and its own `@Param`/`@Query`/`@Body` — is
never inspected by `@Kavo`; it is an ordinary Nest controller method that
happens to live on a `@Kavo`-decorated class. The only Kavo-specific
piece it typically wants is the entity's bound service, reachable the
same way an `@Override`'d method reaches it — `boundKavoService(this)`,
which reads the property `KavoBinder` already bound at
`onModuleInit`:

```ts
@Controller("users")
@Kavo(User)
export class UserController {
  private get base(): DefaultKavoService<User> {
    return boundKavoService<User>(this);
  }

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
`@Kavo` in the picture. Reach for `@Override` when the action is one of
the standard operations and should keep getting its route/Swagger/param
metadata generated from config while only its implementation changes;
reach for a plain native-decorated method for anything else — an action
with no operation identity of its own needs none of that generated
machinery. `examples/nest-typeorm/src/address/address.controller.ts`'s
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
(`User_findMany`), the `:id` param, the query params documented on list
routes (doc 5), registered DTO classes as body schemas (`ApiBody`), and
problem-details response schemas for 400/404. Allowlist-derived
per-field query documentation needs ORM metadata, which doesn't exist at
decoration time — revisited in a future DX pass.

## 5. Testing

`tests/binding.e2e.spec.ts` runs a real Nest app over an in-memory fake
infrastructure (no ORM in this package): all six routes, envelope shape,
grammar wiring, problem-details mapping, disabled operations,
manual-method-wins, custom + service-only operations, the service token,
the soft-delete routes, relation includes, and the
Swagger body/hint schemas. The full-stack path (Nest → engine → TypeORM → SQLite) is the
checkpoint app's suite in `examples/nest-typeorm`.
