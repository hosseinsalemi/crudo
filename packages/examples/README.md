# examples

The checkpoint app: a small Pet domain served over HTTP by the real stack
— `@Crud(...)`-generated NestJS routes → CRUD engine → `@crudo/typeorm` →
in-memory SQLite — with filtering, sorting, pagination, DTO projections
(`item` vs. leaner `list`), layered config, Swagger docs, and RFC 9457
problem-details errors. `Cat` and `Dog` are single-table-inheritance
subtypes of `Pet`; `Owner` is the relation side, and is soft-deletable.

```bash
pnpm build && pnpm --filter @crudo/examples start
# → http://localhost:3000/cats   (Swagger at /docs)
```

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

The e2e suite in `tests/` is the executable form of the milestone
checkpoints. This app grows into the Phase 17 reference application
(`User`, `Project`, `Task`, `Comment`, `Tag`).

The app consumes only public package APIs — if it ever needs a deep
import, that is an API-surface bug in the package, not the app.
