# Glossary

One canonical name per concept. Every phase and document uses these terms
and no synonyms; a synonym in a later phase is a review finding. Naming
rules themselves (prefixes, casing, suffixes) live in the Naming
Conventions section of `crudo-phases-v6.md`.

| Term                   | Meaning                                                                                                                                  | Not called                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Entity**             | The ORM-mapped domain class a Crud instance is built for.                                                                                | model, record                   |
| **Operation**          | One named unit of dispatch (`createOne`, `findMany`, custom ids). Always names its cardinality: `<verb>One` / `<verb>Many`.              | action, endpoint, method        |
| **Standard operation** | One of the built-in CRUD operations shipped as default registry entries.                                                                 | default operation               |
| **Custom operation**   | A developer-registered operation with its own input/output DTOs (Phase 14).                                                              | custom action                   |
| **Operation registry** | The per-entity table (`OperationRegistry`) the engine dispatches through; route generation reads it.                                     | operation map                   |
| **Handler**            | The execution unit of one operation (`OperationHandler.execute`).                                                                        | resolver, executor              |
| **Adapter**            | An ORM-facing implementation of core persistence contracts (`TypeOrmRepositoryAdapter`). Named for what it adapts.                       | driver, provider                |
| **Reader / Writer**    | The read half (`EntityReader`) and write half (`EntityWriter`) of an adapter; `RepositoryAdapter` is both.                               | repository, DAO                 |
| **Engine**             | The core pipeline that runs the request lifecycle (`CrudEngine`, Phase 7).                                                               | runtime, kernel                 |
| **Context**            | The per-request object threaded through the pipeline (`CrudContext`).                                                                    | request state                   |
| **Query context**      | Caller-facing query input (`QueryContext`) or its validated normalized form (`NormalizedQueryContext`).                                  | search, criteria                |
| **Filter AST**         | The provider-independent expression tree (`FilterExpression`) built from wire filters.                                                   | where clause                    |
| **Wire token**         | The camelCase operator spelling on the query string (`eq`, `notIn`); the AST uses SCREAMING_SNAKE.                                       | alias                           |
| **Allowlist**          | The per-entity list of filterable/sortable/selectable fields and relation paths; anything outside it is a 400.                           | whitelist                       |
| **DTO slot**           | One of the six DTO positions: `create`, `update`, `patch`, `query`, `item`, `list`.                                                      | shape, schema                   |
| **Envelope**           | A framework-owned response wrapper: `ListResultDto`, `BulkResultDto`.                                                                    | wrapper, payload                |
| **Include**            | Client-requested embedding of a relation (`include=posts.comments`); resolved into an `IncludeTree`.                                     | expand, populate, join          |
| **Include tree**       | The validated tree of relation nodes handed to the adapter.                                                                              | include graph                   |
| **Field selection**    | Sparse fieldsets (`fields=`, `fields[rel]=`), applied after DTO mapping.                                                                 | projection                      |
| **Bulk**               | The feature term for batch operations (config key `bulk`, `/bulk` routes, `BulkResultDto`). Never a method prefix — methods are `*Many`. | batch (in API names)            |
| **Settings**           | The layered config values (`CrudoSettings`) merged through the precedence chain.                                                         | options (reserved for per-call) |
| **Resolved config**    | The frozen per-entity merge result (`ResolvedEntityConfig`), computed once at bootstrap.                                                 | effective config                |
| **Per-call options**   | The last precedence link, passed as parameters (`CrudCallOptions`) — never config writes.                                                | overrides object                |
| **Principal**          | The authenticated caller carried opaquely on the context.                                                                                | user, actor                     |
| **Problem details**    | The RFC 9457 error document (`ProblemDetailsDto`) all errors serialize to.                                                               | error response                  |
| **Error code**         | The stable `CRUDO_*` string identifying an error kind; API surface.                                                                      | error type                      |
| **Soft delete**        | Marking a row deleted via the marker field instead of removing it (Phase 15). `restore` un-deletes; `purge` permanently removes.         | archive, trash                  |
