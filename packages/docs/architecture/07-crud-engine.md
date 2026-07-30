# 07 — CRUD Engine

`CrudEngine` (`core/src/engine/crud-engine.ts`) is the authoritative
request lifecycle. Both entry surfaces — the programmatic
`DefaultCrudService` and the generated NestJS routes — build the same
transport-agnostic `CrudRequest` and run the identical pipeline.

## 1. Lifecycle (Template Method; every boundary a seam)

```
CrudRequest
 → Operation Resolution   registry lookup; disabled/unknown → OperationDisabledException
 → Config Resolution      settingsFor(operation) + per-call overrides (parameters, never writes)
 → Query Resolution       reads only: WireQuery → normalizeWire, QueryContext → normalizeInput
 → Context Assembly       CrudContext: identity, config view, principal, transaction ⟨reserved⟩,
                          normalized query, correlationId, typed state bag
 → DTO Resolution         descriptor.input/output else the doc-4 slot default
 → Deserialization        writes only: body → allowed-key projection
 → Handler Execution      OperationHandler from the registry (built-in, overridden, or custom)
 → Response Mapping       item / ListResultDto envelope / void
 → Serialization          DTO mapping → field selection
CrudResponse
```

Deliberately lean: no validation stage, no hooks, no policy stage — the
v6 tradeoff. Cross-cutting behavior lives in the consumer's own code
around Kavo.

`createOne` and custom operations share one input-resolution branch: the
deserialized body alone when the request carries no id, or `{ id, body }`
when it does (a custom operation addressed by `:id` — cardinality `"one"`,
same as `updateOne`/`patchOne` — needs the id to identify its target, and
`request.id` is simply absent for `createOne`).

## 2. `CrudContext` contents

Entity + operation identity, the resolved config view (with per-call
settings already merged), `principal` (opaque to core, set by the
framework layer), `transaction` (an opaque handle a programmatic caller may
pass through `CrudCallOptions`; `null` otherwise, and nothing in v6 creates
one — the adapter-level hook is reserved), the normalized
query for reads (`null` for writes), a `correlationId` (generated if the
caller didn't forward one), and the typed `state` bag
(`StateKey<T>`-keyed) for custom handlers to pass data.

## 3. Built-in handlers

Ordinary registry entries (ADR-0006), one adapter call each plus the
"missing vs. error" decision — adapters return `null`, handlers raise
`NotFoundException`. `findMany` returns `{ entities, total }` where
`total` is only computed when `pagination.count` is true (a separate
count query, never `getManyAndCount`). `deleteOne`/`restoreOne`/
`purgeOne` are equally ordinary entries — the delete strategy is resolved
in config and applied by the adapter (doc 11), so no handler branches on
it. The batch (`*Many`) entries are registered **disabled**: calling one
raises `OperationDisabledException` and no route generates — a real seam,
not a TODO.

The engine also coerces URL path ids against the id column's kind, so
`GET /users/abc` on a numeric key is a clean 400 rather than a driver
error.

## 4. Patterns

The engine's share of the catalog; the full list, with implementation
files and the ADR behind each, is
[doc 01 §6](01-system-architecture.md#6-design-patterns-and-why).

- **Template Method** — the fixed lifecycle above.
- **Strategy** — repository adapter, serializer/deserializer, pagination
  strategies, error handler: all constructor-injected interfaces.
- **Dependency Injection** — `CrudEngineDependencies` is plain
  constructor injection; no container in core (`@kavo/nest` provides
  one at the framework layer).

## 5. Root factory (`createKavo` / `createCrud`)

`createKavo(options)` holds the global scope; `createCrud(Entity,
config?, runtime?)` is bootstrap: resolve config (doc 08), build the
registry with built-in handlers, wire serializer/deserializer/normalizer
from entity metadata, and return the bound service. Metadata and adapter
come from `options.infrastructure` (the ORM package's implementation of
the seam) or per-call `runtime` overrides — which is what makes the
engine fully testable with an in-memory fake and no ORM anywhere
(`core/tests/engine.spec.ts`).
