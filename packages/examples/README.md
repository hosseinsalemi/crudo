# examples

The checkpoint app: a small Pet domain served over HTTP by the real stack
— `@Kavo(...)`-generated NestJS routes → CRUD engine → `@kavo/typeorm` →
a real database — with filtering, sorting, pagination, DTO projections
(`item` vs. leaner `list`), layered config, Swagger docs, and RFC 9457
problem-details errors. `Cat` and `Dog` are single-table-inheritance
subtypes of `Pet`; `Owner` is the relation side, and is soft-deletable.

The entities, DTOs, and controllers are entirely database-agnostic through
`@kavo/typeorm` — only `DatabaseModule`/`AppModule` (both dynamic modules,
via `.forRoot(...)`) pick a driver, so the same app runs against either
database below unchanged.

## SQLite (default)

No setup required — an in-memory database is created fresh on every run.

```bash
pnpm build && pnpm --filter @kavo/examples start
# → http://localhost:3000/cats   (Swagger at /docs)
```

## Postgres

`main-postgres.ts` boots the same app against a real Postgres instance,
with connection settings hardcoded to match a single local container:

```bash
docker run --rm -e POSTGRES_PASSWORD=kavo -e POSTGRES_DB=kavo -p 5432:5432 postgres:18-alpine
pnpm build && pnpm --filter @kavo/examples start:postgres
# → http://localhost:3000/cats   (Swagger at /docs)
```

The e2e suite (`tests/app-postgres.e2e.spec.ts`) needs none of this set up
by hand — it self-provisions a Postgres container via Testcontainers and
passes that container's connection options straight to
`AppModule.forRoot(...)`, so `pnpm check`/`pnpm test` exercises both
databases with no manual step. This does require a running Docker daemon
wherever those commands run.

Try it:

```
POST   /cats                     {"name":"Whiskers","age":3,"size":"small","indoor":true,"livesLeft":9}
GET    /cats?filter[age][gte]=3&sort=-age&limit=2&offset=0&fields=id,name
GET    /cats/1

POST   /owners                   {"name":"Ada","email":"ada@x.io"}
DELETE /owners/1                 # soft delete — the row is stamped, not removed
GET    /owners?withDeleted=true  # …and still reachable when asked for
PATCH  /owners/1/restore
DELETE /owners/1/purge           # permanent, and only for an already-deleted row

GET    /owners?include=pets              # to-many: batch-loaded, one query per page
GET    /cats?include=owner               # to-one: joined into the same query
GET    /cats?include=owner&fields[owner]=id,name
POST   /cats                     {"name":"Kit","age":1,"owner":1}   # associate by id
```

The e2e suite in `tests/` is the executable form of the behavior spec.
`crud-e2e.suite.ts` holds the shared assertions; `app.e2e.spec.ts`
and `app-postgres.e2e.spec.ts` each boot the app against their own database
and run the same suite against it — one behavioral spec, two drivers. This
app grows into a fuller reference application (`User`, `Project`, `Task`,
`Comment`, `Tag`).

The app consumes only public package APIs — if it ever needs a deep
import, that is an API-surface bug in the package, not the app.
