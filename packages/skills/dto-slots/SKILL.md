---
name: dto-slots
description: Reference for Kavo's six optional DTO slots (create/update/patch/query/item/list) — entity-derived defaults, the dtoShapeKeys narrowing rule, and serialization order. Use when registering a DTO class on @Crud's dto option, or answering "why isn't my field showing/hiding" or "what shape does this response have" questions.
---

# DTO slots reference

Every REST verb has an independent, **optional** data contract. Zero config
means entity-derived defaults; registering a class narrows exactly one slot.
DTOs are shapes for **typing, serialization, and Swagger docs only** — there
is no validation subsystem attached to them (that's the caller's own
pipe/guard, e.g. Nest's `ValidationPipe`). Full detail:
`packages/docs/architecture/04-dto-system.md`. Config-side wiring
(`@Crud(Entity, { dto: {...} })`) is in the `crud-decorator` skill.

## The six slots

| Slot     | Verb / context                        | Default when omitted                                             |
| -------- | -------------------------------------- | ------------------------------------------------------------------ |
| `create` | `POST` body                            | Entity minus generated + relation fields                          |
| `update` | `PUT` body                             | Same default as `create`                                          |
| `patch`  | `PATCH` body                           | `Partial<update>` if `update` registered, else `Partial<Entity>`   |
| `query`  | `GET` list input                       | Generic `QueryContext<Entity>`                                    |
| `item`   | Any single-resource response           | Entity, subject to field selection                                |
| `list`   | Element type in `ListResultDto.items`  | Same as `item`'s resolved type                                    |

`restoreOne` reuses the `item` slot — there is no seventh slot for it.
Naming convention (CLAUDE.md): request bodies are `<Verb><Entity>Dto`
(`CreateUserDto`); query/response shapes are `<Entity><Slot>Dto`
(`UserItemDto`, `UserListDto`).

Each slot resolves **independently at bootstrap** and is cached on the
resolved config — never re-derived per request. `patch → update` and
`list → item` are the only fallback chains; nothing else falls back.

## Runtime derivation (when a slot is left unregistered)

- **Readable projection** (`item`/`list` default): every scalar column.
  Relation properties are excluded unless the request includes them
  deliberately; getters/methods never appear (not columns).
- **Writable projection** (`create`/`update`/`patch` default): every scalar
  column with `generated: false`. Generated columns (auto ids,
  `@CreateDateColumn`, versions) can never be written from a request body —
  the default deserializer silently strips them.
- **Embedded objects** map to a `json`-kind column and travel as one opaque
  value; they are not flattened into sub-fields.

## Registering an explicit DTO class — the `dtoShapeKeys` rule

A registered class projects by its **runtime key set**: the own enumerable
properties of `new Dto()`. TypeScript field declarations only exist at
runtime once **initialized**:

```ts
class UserListDto {
  id = 0;
  name = "";
} // projects [id, name]

class BadDto {
  id!: number; // declared, never initialized
} // no runtime keys → silently falls back to the entity-derived default
```

This is a common gotcha: a DTO class with only `!:`-declared fields and no
constructor/initializer narrows nothing — the response is still correct,
just not narrowed the way you expected. Always give DTO fields a default
value if you want them to actually constrain the projection.

## Serialization order (normative)

**DTO mapping happens first, then field selection.**
`fields=id,name` can only narrow what the resolved DTO already exposes —
selection never widens a projection. If a field isn't on the `item`/`list`
DTO, `fields=` can't bring it back. (Implemented as
`projection ∩ selection` in `DefaultSerializer.serializeItem`.)

## Included relations have no separate DTO slot

When a response embeds an included relation (`include=pets`), the node's
shape comes from the **target entity's own registered `item`/`list` DTOs**
(falling back to that entity's own derived default) — never a DTO
registered on the parent. The relation is a full resource in its own right;
see the `crud-decorator` skill's "relations" section for how inclusion
itself is allowlisted.
