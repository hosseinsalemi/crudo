# 07 — CRUD Engine

`KavoEngine` (`core/src/engine/kavo-engine.ts`) is the authoritative
request lifecycle. Both entry surfaces — the programmatic
`DefaultKavoService` and the generated NestJS routes — build the same
transport-agnostic `KavoRequest` and run the identical pipeline.

## 1. Lifecycle (Template Method; every boundary a seam)

```
KavoRequest
 → Operation Resolution   registry lookup; disabled/unknown → OperationDisabledException
 → Config Resolution      settingsFor(operation) + per-call overrides (parameters, never writes)
 → Query Resolution       reads only: WireQuery → normalizeWire, QueryContext → normalizeInput
 → Context Assembly       KavoContext: identity, config view, principal, transaction ⟨reserved⟩,
                          normalized query, correlationId, typed state bag
 → DTO Resolution         descriptor.input/output else the doc-4 slot default
 → Deserialization        writes only: body → allowed-key projection
 → Handler Execution      OperationHandler from the registry (built-in, overridden, or custom)
 → Response Mapping       item / ListResultDto envelope / void
 → Serialization          DTO mapping → field selection
KavoResponse
```

Deliberately lean: no validation stage, no hooks, no policy stage — the
v6 tradeoff. Cross-cutting behavior lives in the consumer's own code
around Kavo.

`createOne` and custom operations share one input-resolution branch: the
deserialized body alone when the request carries no id, or `{ id, body }`
when it does (a custom operation addressed by `:id` — cardinality `"one"`,
same as `updateOne`/`patchOne` — needs the id to identify its target, and
`request.id` is simply absent for `createOne`).

## 2. `KavoContext` contents

Entity + operation identity, the resolved config view (with per-call
settings already merged), `principal` (opaque to core, set by the
framework layer), `transaction` (an opaque handle a programmatic caller may
pass through `KavoCallOptions`; `null` otherwise, and nothing in v6 creates
one — the adapter-level hook is reserved), the normalized
query for reads (`null` for writes), a `correlationId` (generated if the
caller didn't forward one), and the typed `state` bag
(`StateKey<T>`-keyed) for custom handlers to pass data.

## 3. Built-in handlers

Ordinary registry entries (ADR-0006), one adapter call each plus the
"missing vs. error" decision — adapters return `null`, handlers raise
`NotFoundException`. `findMany` returns `{ entities, total, meta? }` where
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

### 3.1 The list envelope's `meta`

`FindManyResult.meta` is optional and the built-in handler never sets it,
so a zero-config list still reports `meta: {}`. What makes it a real seam
is that response mapping **merges** what it finds there rather than
discarding it (issue #122): an overriding or wrapping `findMany` handler
returns `meta` alongside `entities`/`total`, and it lands on
`ListResultDto.meta` verbatim. `meta` is caller data, not entity data, so
it never passes through the serializer — no DTO projection, no `fields=`
selection, no renaming.

`KavoEngine.listMeta` is that single merge point, named rather than
inlined because the handler is only the first contributor: a pagination
strategy computing `meta.nextCursor` belongs to the engine, not to
whichever handler happens to be configured, and folds in there.
`withListMeta(handler, compute)` (`core/src/engine/with-list-meta.ts`) is
the ergonomic wrap for the common case; its merge precedence is the
contributor's keys over the wrapped handler's, matching the direction
config precedence already runs (global → entity → operation → per-call).
It is typed against `OperationHandler<Entity>` so it composes with
`builtInHandlers(...)` and `OperationConfig.handler` without a cast, which
erases the output type — hence the runtime shape check that raises
`ConfigurationException` instead of assembling a malformed envelope.

Not to be confused with `OperationConfig.meta` (`OperationMetadata`,
ADR-0007): that is route/framework metadata on a registry entry and never
reaches a response body.

## 4. Patterns

The engine's share of the catalog; the full list, with implementation
files and the ADR behind each, is
[doc 01 §6](01-system-architecture.md#6-design-patterns-and-why).

- **Template Method** — the fixed lifecycle above.
- **Strategy** — repository adapter, serializer/deserializer, pagination
  strategies, error handler: all constructor-injected interfaces.
- **Dependency Injection** — `KavoEngineDependencies` is plain
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
