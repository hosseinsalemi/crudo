# examples

The checkpoint app: a small Pet domain served over HTTP by the real stack
— `@Kavo(...)`-generated NestJS routes → CRUD engine → `@kavo/typeorm` →
a real database — with filtering, sorting, pagination, DTO projections
(`item` vs. leaner `list`), layered config, Swagger docs, and RFC 9457
problem-details errors. `Cat` and `Dog` are single-table-inheritance
subtypes of `Pet`; `Owner` is the relation side, and is soft-deletable.

A second, smaller app (`src/mongo/`) serves a Blog domain through
`@kavo/mongoose` instead — see [MongoDB](#mongodb) below. It exists
because the Pet app can only ever prove the SQL path: the Mongoose one is
what shows the same decorator, engine and route generation working over a
document store.

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

## MongoDB

`main-mongo.ts` boots a different app — the Blog domain in `src/mongo/`,
served through `@kavo/mongoose`:

```bash
docker run --rm -p 27017:27017 mongo:8
pnpm build && MONGO_URL=mongodb://127.0.0.1:27017/kavo pnpm --filter @kavo/examples start:mongo
# → http://localhost:3001/articles   (Swagger at /docs)
```

Its e2e suite (`tests/app-mongo.e2e.spec.ts`) needs no setup either — it
provisions an in-memory MongoDB via `mongodb-memory-server`, so
`pnpm check` exercises the full Nest → engine → Mongoose → MongoDB path
with no manual step. (First run downloads a `mongod` binary and caches it,
so it needs network access once.)

Notice how much less wiring `MongoAppModule` needs than
`AppModule` + `DatabaseModule`: there is no entity list and no
`DataSource`, because a Mongoose model _is_ the entity identity Kavo wants
and `mongoose.connection` already is the model registry (ADR-0018).

```
POST   /authors                  {"name":"Ada","email":"ada@x.io"}
POST   /articles                 {"title":"Hello","tags":["intro"],"author":"<author _id>"}
GET    /articles?filter[status][eq]=published&sort=-createdAt
GET    /articles?include=author            # loaded by populate, not a join
GET    /articles?filter[author][eq]=<id>   # the ref path is the foreign key too
DELETE /articles/<id>            # soft delete — `deletedAt` is stamped
PATCH  /articles/<id>/restore
```

Ids are MongoDB `_id` values rendered as hex **strings**, so responses are
keyed by `_id` rather than a numeric `id`. Filtering _across_ a relation
(`filter[author.name]`) is refused with a 400 rather than silently
matching nothing — MongoDB resolves dotted paths inside a document, not
across a `ref`.

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
and run the same suite against it — one behavioral spec, two drivers.
`app-mongo.e2e.spec.ts` deliberately does _not_ reuse that suite: it is
written against the TypeORM app's numeric `id` and single-table
inheritance, and forking its assertions would hide exactly the difference
a document store is there to show. This app grows into a fuller reference
application (`User`, `Project`, `Task`, `Comment`, `Tag`).

The app consumes only public package APIs — if it ever needs a deep
import, that is an API-surface bug in the package, not the app.
