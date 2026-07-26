# 04 — Optional DTO System (Phase 4)

Every REST verb has an independent, optional data contract. Zero config
means entity-derived defaults; registering a class narrows exactly one
slot. DTOs in v6 are shapes for **typing, serialization, and Swagger
docs** — there is no validation subsystem attached to them.

## 1. The six slots and their defaults

| Slot     | Verb / context                        | Default when omitted                                             |
| -------- | ------------------------------------- | ---------------------------------------------------------------- |
| `create` | `POST` body                           | Entity minus generated + relation fields                         |
| `update` | `PUT` body                            | Same default as `create`                                         |
| `patch`  | `PATCH` body                          | `Partial<update>` if `update` registered, else `Partial<Entity>` |
| `query`  | `GET` list input                      | Generic `QueryContext<Entity>`                                   |
| `item`   | Any single-resource response          | Entity, subject to field selection                               |
| `list`   | Element type in `ListResultDto.items` | Same as `item`'s resolved type                                   |

Restore (Phase 14) and custom operations (Phase 13) reuse `item`/`list`;
no additional slots exist.

## 2. Resolution algorithm

`DefaultDtoResolver` (`core/src/dto/default-dto-resolver.ts`) resolves
each slot **independently at bootstrap** and caches the result on the
resolved config — never per request. Resolution returns the registered
class or `null`, where `null` means "use the entity-derived default".
The fallback chains `patch → update` and `list → item` are baked in at
construction, mirroring the static generic defaults (doc 03 §1), so the
type level and the runtime never disagree about which slot follows which.

## 3. Runtime derivation rules

The metadata seam (`EntityMetadata`, doc 09 §1) supplies the field list
the defaults derive from:

- **Readable projection** (`item`/`list` default): every scalar column.
  Relation properties are excluded unless the request includes them
  deliberately; getters/methods never appear (they are not columns).
- **Writable projection** (`create`/`update`/`patch` default): every
  scalar column with `generated: false`. Generated columns (auto ids,
  `@CreateDateColumn`, versions) can never be written from a request
  body — the default deserializer silently strips them, which is the safe
  posture in a system with no validation stage.
- **Embedded objects** map to a `json`-kind column and travel as one
  opaque value; they are not flattened into sub-fields.

## 4. Explicit DTO classes and `dtoShapeKeys`

A registered class projects by its **runtime key set**: the own
enumerable properties of `new Dto()` (`dto-shape.ts`, cached per class).
TypeScript fields only exist at runtime when initialized, so:

```ts
class UserListDto {
  id = 0;
  name = "";
} // projects [id, name]
class BadDto {
  id!: number;
} // no runtime keys → falls back
```

A class with no initialized fields degrades to the entity-derived
default — the response is still correct, just not narrowed. This keeps
DTO classes plain (no decorators, no reflection library) at the cost of
requiring initializers for narrowing; the tradeoff is documented API.

## 5. Serialization order (normative)

**DTO mapping first, then field selection.** `fields=id,name` can only
narrow what the resolved DTO exposes — selection never widens a
projection. Implemented in `DefaultSerializer.serializeItem`:
projection ∩ selection, applied to every item and list element.

## 6. Included relations (Phase 15)

When a response embeds an included relation, the node's shape resolves
from the **target entity's own registered `item`/`list` DTOs** when that
entity has a Kavo config, else its entity-derived default. There is no
per-include DTO slot — the related resource owns its own contract.
