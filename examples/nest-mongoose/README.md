# nest-mongoose

A small Blog domain served over HTTP by the real stack — `@Kavo(...)`-generated
NestJS routes → CRUD engine → `@kavo/mongoose` → a real MongoDB — with
filtering, sorting, pagination, DTO projections (`item` vs. leaner `list`),
layered config, Swagger docs, and RFC 9457 problem-details errors. `Author` is
the relation side; `Article` carries a `ref` edge, a scalar array, and
config-declared soft delete.

It is the document-store counterpart to [`nest-typeorm`](../nest-typeorm),
which can only ever prove the SQL path. This app is what shows the same
decorator, engine, and route generation working over MongoDB.

```bash
docker run --rm -p 27017:27017 mongo:8
pnpm build && MONGO_URL=mongodb://127.0.0.1:27017/kavo pnpm --filter @kavo/example-nest-mongoose start
# → http://localhost:3001/articles   (Swagger at /docs)
```

`MONGO_URL` defaults to `mongodb://127.0.0.1:27017/kavo`.

The e2e suite (`tests/app.e2e.spec.ts`) needs none of this set up by hand — it
provisions an in-memory MongoDB via `mongodb-memory-server`, so `pnpm check`
exercises the full Nest → engine → Mongoose → MongoDB path with no manual
step. (The first run downloads a `mongod` binary and caches it, so it needs
network access once.)

## What's different from the TypeORM app

Notice how much less wiring `AppModule` needs than `nest-typeorm`'s
`AppModule` + `DatabaseModule`: there is no entity list and no `DataSource`,
because a Mongoose model _is_ the entity identity Kavo wants and
`mongoose.connection` already is the model registry (ADR-0018). Nothing is
declared twice — no marker classes, no mirror of the schema.

Try it:

```
POST   /authors                  {"name":"Ada","email":"ada@x.io"}
POST   /articles                 {"title":"Hello","tags":["intro"],"author":"<author _id>"}
GET    /articles?filter[status][eq]=published&sort=-createdAt
GET    /articles?include=author            # loaded by populate, not a join
GET    /articles?filter[author][eq]=<id>   # the ref path is the foreign key too
DELETE /articles/<id>            # soft delete — `deletedAt` is stamped
GET    /articles?withDeleted=true
PATCH  /articles/<id>/restore
DELETE /articles/<id>/purge      # permanent, and only for an already-deleted doc
```

Ids are MongoDB `_id` values rendered as hex **strings**, so responses are
keyed by `_id` rather than a numeric `id`. Filtering _across_ a relation
(`filter[author.name]`) is refused with a 400 rather than silently matching
nothing — MongoDB resolves dotted paths inside a document, not across a `ref`.

The e2e suite deliberately does not reuse `nest-typeorm`'s
`crud-e2e.suite.ts`: that suite is written against a numeric `id` and
single-table inheritance, and forking its assertions would hide exactly the
difference this app exists to show.

The app consumes only public package APIs — if it ever needs a deep import,
that is an API-surface bug in the package, not the app.
