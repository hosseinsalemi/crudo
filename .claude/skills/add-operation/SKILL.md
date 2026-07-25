---
name: add-operation
description: The end-to-end procedure for adding, overriding, or disabling a Crudo operation — registry entry, DTO slots, handler, route metadata, and tests. Use when a change introduces a new CRUD operation or a custom per-entity operation.
---

# Adding an operation

The whole point of Crudo's design is that **adding an operation is adding a
registry entry** (ADR-0006). The engine loops over registry entries and
`@crudo/nest` generates one route per enabled entry from the same registry. If
your change needs a new `if` in the engine or in the route generator, the design
is wrong — stop and reconsider.

## Decide which of the three you are doing

All three are the same mechanism (`EntityConfig` in
`packages/core/src/config/entity-config.ts`):

| Intent                            | How                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disable** a standard operation  | `operations: { deleteOne: false }` — the entry stays in the registry so tooling can report it, but calling it raises `OperationDisabledException` and no route is generated. |
| **Override** a standard operation | `operations: { findOne: { handler } }` — replaces the handler, keeps the default DTO and serialization scaffolding.                                                          |
| **Add a custom** operation        | `customOperations: { complete: { handler, input, output, meta } }` — declares its own input/output DTOs, because its shape is not guaranteed CRUD-like.                      |

Standard operations that are off by default (`purgeOne`, `restoreOne`) are
turned on with `operations: { purgeOne: true }`.

## The descriptor

Every entry is an `OperationDescriptor`
(`packages/core/src/operations/operation-registry.ts`):

- `id` — camelCase, **always naming cardinality**: `<verb>One` / `<verb>Many`.
  "Bulk" is a feature term, never a method prefix.
- `kind` — `"read" | "write"`. This drives lifecycle branching: reads run query
  resolution, writes do not.
- `cardinality` — `"one" | "many"`, matching the id.
- `enabled` — disabled entries stay registered but never execute.
- `handler` — an `OperationHandler`: `execute(input, context)`. One contract for
  built-in, overridden and custom operations alike.
- `input` / `output` — explicit DTO classes, or `null` to take the slot default.
- `meta` — the opaque, module-augmentable metadata bag.

## Route metadata

Core knows nothing about HTTP. Routes are expressed through `meta`, which
`@crudo/nest` augments:

```ts
meta: {
  routes: { method: "POST", path: ":id/complete", enabled: true },
}
```

- Custom operations **must** carry `meta.routes` to get a route.
- `meta.routes.enabled: false` keeps an operation service-only — callable in
  code, no HTTP route.
- Routes are generated at **decoration time** (ADR-0012), the only moment Nest's
  router scan sees the methods. Nothing may defer registration.
- **Manual-method-wins**: a hand-written controller method whose name matches an
  operation id suppresses the generated route.

## Naming (normative — get this right the first time)

- Operation ids: `<verb>One` / `<verb>Many`, camelCase. Config keys under
  `operations` use the same names.
- DTO slots are bare verbs — `create`, `update`, `patch`, `query`, `item`,
  `list` — because `createOne` and `createMany` share the `create` DTO.
- DTO classes: request bodies `<Verb><Entity>Dto`; query/response shapes
  `<Entity><Slot>Dto`. Every wire-crossing shape carries `Dto`; behavioral
  contracts never do.
- New exceptions are `*Exception` with a stable `CRUDO_SNAKE_CASE` code.

## Where the work lands

1. **`packages/core`** — the descriptor and its handler. If it is a new standard
   operation, add the id to `StandardOperationId`
   (`packages/core/src/operations/operation.ts`) and a default entry in
   `default-operation-registry.ts`; add a handler in `engine/built-in-handlers.ts`.
2. **The barrel** — `packages/core/src/index.ts` is an explicit named list
   (ADR-0010). Export new public types there deliberately; nothing leaks in by
   `export *`.
3. **`packages/orms/typeorm`** — only if the operation needs new adapter
   capability. Keep every TypeORM type inside this package; core takes
   adapter-owned values as `unknown` behind a named contract.
4. **`packages/frameworks/nest`** — usually **nothing**. Route generation reads
   the registry, so a new enabled entry with `meta.routes` becomes a route with
   no generator changes. Touching the generator is a signal you special-cased.

## Tests

Follow the `write-tests` skill, and cover at minimum:

- the operation executes and returns the right shape;
- disabled → `OperationDisabledException` with its code;
- the registry reports the entry via `all()` whether enabled or not;
- the generated route exists with the expected method and path, and is absent
  when disabled or `meta.routes.enabled: false`;
- manual-method-wins suppression, if a controller method could collide.

Finish with `pnpm check`.
