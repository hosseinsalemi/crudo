# @kavo/typeorm

TypeORM adapter for Kavo: implements `RepositoryAdapter`
(`EntityReader` + `EntityWriter`) and `FilterBuilder` from `@kavo/core`
over TypeORM's Repository and QueryBuilder APIs. `TransactionManager` is
not implemented — see the `@remarks` on that interface in `@kavo/core`.

**May depend on:** `@kavo/core`, `typeorm` (peer). **Never on:**
`@kavo/nest` or any framework.

Fully implemented: CRUD, filtering/sorting/pagination, soft delete, and
relation includes all run through this adapter.
