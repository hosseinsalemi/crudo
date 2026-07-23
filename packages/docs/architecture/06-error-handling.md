# 06 — Error Handling (Phase 6)

One exception hierarchy in `core/src/errors/`, one stable code catalog,
one wire shape (RFC 9457 problem details, ADR-0009). Later phases add
leaves; nothing existing changes.

## 1. Hierarchy

```
CrudoException (abstract; implements the CrudException contract)
├─ QueryValidationException     carries issues[] → errors[] extension
├─ NotFoundException
├─ ConflictException
├─ AlreadyDeletedException      (Phase 15 leaf, reserved now → 409)
├─ NotDeletedException          (Phase 15 leaf, reserved now → 409)
├─ OperationDisabledException
├─ BulkOperationException       carries items[] (Phase 15, reserved)
├─ PersistenceException
├─ TransactionException         carries retryable: boolean
└─ ConfigurationException       bootstrap-only, never a wire response
```

Every leaf binds exactly one catalog code; status, title, and the English
message template come from the catalog, so an exception cannot disagree
with it. Downstream layers program against the `CrudException` shape;
`@crudo/nest`'s filter uses the base class only as its catch token.

## 2. Error-code catalog

Codes are API surface — renaming one is a breaking change (Phase 19
semver policy). Source of truth: `ERROR_CATALOG` in
`core/src/errors/error-catalog.ts`.

| Code                            | HTTP | Fires when                                                                 | Payload extensions                |
| ------------------------------- | ---- | -------------------------------------------------------------------------- | --------------------------------- |
| `CRUDO_QUERY_INVALID`           | 400  | Any query grammar/allowlist/limit violation (aggregate)                    | `errors[]` of the sub-codes below |
| `CRUDO_QUERY_INVALID_FIELD`     | 400  | Field not on the filter/sort/select allowlist                              | issue-level                       |
| `CRUDO_QUERY_INVALID_OPERATOR`  | 400  | Unknown or misspelled wire operator                                        | issue-level                       |
| `CRUDO_QUERY_INVALID_VALUE`     | 400  | Coercion failure, malformed bounds, bad pagination value                   | issue-level                       |
| `CRUDO_QUERY_LIMIT_EXCEEDED`    | 400  | maxFilterDepth / maxInValues exceeded                                      | issue-level                       |
| `CRUDO_QUERY_UNSUPPORTED_PARAM` | 400  | `include`, `withDeleted=true`, `fields[relation]` before their phase       | issue-level                       |
| `CRUDO_NOT_FOUND`               | 404  | Target row missing on findOne/update/patch/delete                          | —                                 |
| `CRUDO_CONFLICT`                | 409  | Unique/FK violation mapped by the adapter                                  | —                                 |
| `CRUDO_ALREADY_DELETED`         | 409  | Soft-deleting a deleted row (Phase 15)                                     | —                                 |
| `CRUDO_NOT_DELETED`             | 409  | Restoring a live row (Phase 15)                                            | —                                 |
| `CRUDO_OPERATION_DISABLED`      | 405  | Programmatic call to a disabled registry entry (no route exists over HTTP) | —                                 |
| `CRUDO_BULK_FAILED`             | 422  | Atomic bulk failure (Phase 15)                                             | `items[]` per-index issues        |
| `CRUDO_PERSISTENCE_FAILED`      | 500  | Unrecognized adapter/driver error                                          | `cause` kept internally           |
| `CRUDO_TRANSACTION_FAILED`      | 500  | Deadlock/serialization failure                                             | `retryable` flag                  |
| `CRUDO_CONFIG_INVALID`          | 500  | Bootstrap config error (fails startup, not a response)                     | —                                 |

## 3. Error context & message strategy

Every exception carries `ErrorContext` (`entityName`, `operation`,
`correlationId`); the engine's `DefaultErrorHandler` fills whatever the
throw site didn't know. Human-readable `detail` strings are rendered from
`messageKey` (= the code) + `messageParams` via the catalog's `{param}`
templates, so a consumer can localize by re-rendering the same key and
params; core ships the English defaults.

## 4. Mapping strategy

Adapter errors are translated by the adapter's own table
(`@crudo/typeorm`'s `mapDriverError`, doc 09 §5) _inside_ the adapter;
whatever reaches the engine unrecognized becomes `PersistenceException`
with the original as `cause` — never swallowed. Whether `cause` details
leak into responses is governed by `errors.exposeInternals` (default
`false`).

## 5. Problem-details serialization

`toProblemDetails(exception, { exposeInternals })` produces the wire
document: `type` (`https://crudo.dev/errors/<kebab-code>`), `title` and
`status` from the catalog, `detail`, `instance`
(`urn:crudo:request:<correlationId>`), `code`, plus `errors[]`
(query issues) and `items[]` (bulk, reserved). The `@crudo/nest` filter
maps it 1:1 with `Content-Type: application/problem+json`; a different
wire shape means swapping this serializer, never the hierarchy. Core
never depends on NestJS exceptions — the filter is the boundary.
