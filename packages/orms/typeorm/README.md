# @crudo/typeorm

TypeORM adapter for Crudo: implements `RepositoryAdapter`
(`EntityReader` + `EntityWriter`) and `FilterBuilder` from `@crudo/core`
over TypeORM's Repository and QueryBuilder APIs. `TransactionManager` is
not implemented — see the `@remarks` on that interface in `@crudo/core`.

**May depend on:** `@crudo/core`, `typeorm` (peer). **Never on:**
`@crudo/nest` or any framework.

Scaffold only in Milestone A — architecture lands in Phase 9,
implementation in Phase 10.
