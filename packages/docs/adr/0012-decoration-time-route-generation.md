# ADR-0012 — Decoration-time route generation in @crudo/nest

**Status:** accepted (Phases 11–12)

## Context

Nest's router maps controller methods during `app.init()`, **before** any
module lifecycle hook (`onModuleInit`) runs. Routes must therefore exist
on the controller prototype — with Nest's own route metadata — by the
time the controller class is scanned. But the operation registry that
drives generation (ADR-0006) is naturally a bootstrap product.

## Decision

`@Crud(Entity, config)` generates routes **at class-decoration time**:
it builds the operation registry from the entity config with the same
`createOperationRegistry` the engine uses (in inspection mode — handlers
unbound), defines one method per enabled entry on the prototype, and
applies Nest's real decorators programmatically (`Post(path)(proto,
name, descriptor)`, `Param("id")(…)`, `HttpCode(…)`). The service
instance arrives later through DI: `forFeature` provides it under
`getCrudServiceToken(Entity)` and the generated methods reach it via
property injection.

## Consequences

- Works with Nest's normal controller scan — no custom router, no
  monkey-patching, and guards/interceptors/versioning/prefixes compose
  exactly as with hand-written methods.
- The entity config is stated on the controller (`@Crud(Entity, config)`)
  and read back by `forFeature` from decorator metadata — one source of
  truth for both route generation and service bootstrap; the two can't
  drift.
- Manual-method-wins is a one-line `hasOwnProperty` check at decoration
  time.
- Limitation: decoration time has no ORM metadata, so Swagger docs can't
  enumerate allowlist-derived per-field query params yet (doc 10 §4);
  acceptable for Milestone B, revisited in Phase 16.
