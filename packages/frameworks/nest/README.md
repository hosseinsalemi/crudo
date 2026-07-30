# @kavo/nest

NestJS binding for Kavo: `KavoModule.forRoot`/`forFeature`, the `@Crud`
decorator, registry-driven route generation (manual-method-wins), the
problem-details exception filter, and Swagger integration.

**May depend on:** `@kavo/core`, `@nestjs/*` (peers). **Never on:**
`@kavo/typeorm` or any ORM — adapters enter Nest's DI container as
providers; this package programs against `RepositoryAdapter` only.

Fully implemented: route generation, the exception filter, and Swagger
integration all run through this package.
