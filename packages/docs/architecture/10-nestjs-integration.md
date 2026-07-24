# 10 — NestJS Integration (Phases 11–12)

`@crudo/nest` turns one decorator into a full CRUD controller:

```ts
@Crud(UserEntity)
@Controller("users")
export class UserController {}
```

`@nestjs/common`/`core` are peerDependencies; `@nestjs/swagger` is an
optional peer. The package never imports an ORM adapter (Phase 2
boundary) — infrastructure arrives through DI.

## 1. Module design

- **`CrudoModule.forRoot(options)`** (global): creates the Crudo root
  instance (`createCrudo` skin — `defaults` passes through untouched),
  registers the problem-details exception filter app-wide (`APP_FILTER`),
  and exposes `CRUDO_INSTANCE`. **`forRootAsync`** resolves the options
  via `useFactory`/`inject` — the checkpoint app uses it to wait for the
  `DataSource` before building `createTypeOrmInfrastructure(dataSource)`.
- **`CrudoModule.forFeature(controllers)`**: for each `@Crud`-decorated
  controller, registers the controller and provides the entity's service
  under `getCrudServiceToken(Entity)` (factory:
  `crudo.createCrud(entity, config)` — bootstrap happens here, once).
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
entry) get **no route**. Custom operations read `meta.routes`
(`method`, `path`, `successStatus`); `meta.routes.enabled: false` keeps
one service-only. Because generation walks the registry, Phase 14's
restore/purge appeared by _enabling entries_ — this generator did not
change. Their enablement is config-declared rather than metadata-driven,
precisely because decoration time has no ORM metadata (ADR-0013):
`softDelete: { strategy: "soft" }` adds the restore route,
`operations: { purgeOne: true }` the purge route.

**Manual-method-wins:** a hand-written controller method whose name
matches an operation id suppresses that generated route — detected via
`hasOwnProperty` on the prototype, no config needed.

Mechanically, generated methods are defined on the prototype and
decorated by _calling_ Nest's own decorators (`Post(path)(proto, name,
descriptor)`, `Param("id")(…)`, …) — identical metadata to hand-written
syntax, so guards, interceptors, versioning, and prefixes compose
normally. The service arrives by property injection under a private key;
route handlers wrap `req.query` in core's `WireQuery` (after
`flattenQuery` normalizes qs-extended nested objects back to flat
bracket keys, making the binding query-parser-agnostic).

## 3. Exception mapping

`CrudoExceptionFilter` (`@Catch(CrudoException)`) is the one boundary
between Crudo's hierarchy and HTTP: catalog status +
`application/problem+json` body via `toProblemDetails`, honoring
`errors.exposeInternals`. Crudo exceptions never extend Nest's.

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
