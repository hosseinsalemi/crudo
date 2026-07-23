# @crudo/typeorm

TypeORM adapter for Crudo: implements `RepositoryAdapter`
(`EntityReader` + `EntityWriter`), `FilterBuilder`, and
`TransactionManager` from `@crudo/core` over TypeORM's Repository and
QueryBuilder APIs.

**May depend on:** `@crudo/core`, `typeorm` (peer). **Never on:**
`@crudo/nest` or any framework.

Scaffold only in Milestone A — architecture lands in Phase 9,
implementation in Phase 10.
