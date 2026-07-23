# examples

The **Milestone B checkpoint app**: one entity (`User`) served over HTTP
by the real stack — `@Crud(User)`-generated NestJS routes → CRUD engine →
`@crudo/typeorm` → in-memory SQLite — with filtering, sorting,
pagination, DTO projections (`item` vs. leaner `list`), layered config,
Swagger docs, and RFC 9457 problem-details errors.

```bash
pnpm build && pnpm --filter @crudo/examples start
# → http://localhost:3000/users   (Swagger at /docs)
```

Try it:

```
POST /users                     {"email":"ada@x.io","name":"Ada","age":36}
GET  /users?filter[age][gte]=30&sort=-age&limit=2&offset=0&fields=id,name
GET  /users/1
```

The e2e suite in `tests/` is the executable form of the Milestone B
checkpoint. This app grows into the Phase 18 reference application
(`User`, `Project`, `Task`, `Comment`, `Tag`).

The app consumes only public package APIs — if it ever needs a deep
import, that is an API-surface bug in the package, not the app.
