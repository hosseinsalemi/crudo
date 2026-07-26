# @kavo/typeorm

TypeORM adapter for Kavo: implements `RepositoryAdapter`
(`EntityReader` + `EntityWriter`) and `FilterBuilder` from `@kavo/core`
over TypeORM's Repository and QueryBuilder APIs. `TransactionManager` is
not implemented — see the `@remarks` on that interface in `@kavo/core`.

**May depend on:** `@kavo/core`, `typeorm` (peer). **Never on:**
`@kavo/nest` or any framework.

Scaffold only in Milestone A — architecture lands in Phase 9,
implementation in Phase 10.
