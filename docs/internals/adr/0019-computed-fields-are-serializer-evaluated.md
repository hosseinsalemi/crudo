# ADR-0019 — Computed fields are serializer-evaluated, and never filterable, sortable, or writable

**Status:** accepted

## Context

Every projection Kavo derives comes from the metadata seam (ADR-0011),
which describes **columns**. A field with no backing column — `fullName`
from `firstName`/`lastName`, a formatted total, a caller-dependent flag —
therefore has nowhere to live. The workaround that appeared to work was
registering an `item` DTO naming a property that the entity class happens
to expose as a getter: `DefaultSerializer` copied it because `key in
source` was true. That is an accident of TypeORM handing the engine class
instances. `@kavo/prisma`, `@kavo/mongoose`, and any adapter returning
plain rows carry no getter, so the same config silently emitted nothing —
and no ORM's rows made the field reachable through `fields=`, because the
`selectable` allowlist derives from columns alone.

Making such a field first-class raises one question with a wrong obvious
answer. A field the client can _see_ looks like a field the client should
be able to filter and sort on, and every other selectable path is. But
filtering and sorting are pushed down to the database: the filter
translators turn a path into `WHERE`/`ORDER BY` against a column that must
exist. Honoring `filter[fullName][eq]` would mean fetching rows and
evaluating the predicate in memory — which silently breaks pagination
(`limit`/`offset` are applied by the database, before the predicate),
`total`, and every performance property the query grammar is built on.
The alternative, "just add the field to `selectable` and hope nobody
filters", is exactly the fail-open posture `resolveAllowlists` exists to
prevent.

Where the field is evaluated is the other half. Nothing in the pipeline
before response mapping can produce it: the adapter fetches columns, the
query normalizer validates paths, the handlers move rows. Response
mapping is also the one stage that already sees the fully-hydrated entity
and the request context together.

## Decision

An entity may declare **computed fields** — `EntityConfig.computed`, a
record of `ComputedFieldDescriptor<Entity>` keyed by the name each
serializes as — and they are governed by four rules.

**1. Serializer-evaluated, post-fetch.** `DefaultSerializer` produces a
computed key by calling the descriptor's `resolve(entity, context)`,
never by reading it off the row. That is the only stage involved, which
is what makes computed fields behave identically for a TypeORM class
instance and a Prisma/Mongoose plain object, and why **no ORM adapter
changes**: no adapter consumes `query.fields` (selection is "kept
internally, stripped late"), so every row arrives fully hydrated and a
computed field's source columns are always present, even under
`fields=fullName`. There is no dependency declaration and none is needed.

`resolve` is **synchronous** and runs once per served item. An
async or database-hitting resolver is not offered: it would reintroduce
per-row N+1 at exactly the stage the include resolver exists to batch. An
`async resolve` is a bootstrap error rather than a slow success, because
the serializer emits the return value unawaited and the response would
silently carry `{}`. Returning `undefined` omits the key and `null` emits
it, the same distinction the column branch draws.

**2. Present by default, narrowed like any other field.** A declared
computed field joins the entity-derived `item`/`list` projection with no
DTO registration, and joins the `selectable` allowlist unless the
descriptor sets `selectable: false`. Both narrowing mechanisms then apply
unchanged: an explicit `item`/`list` DTO that omits it hides it, and
`fields=` narrows it away. The normative order is untouched — DTO mapping
first, then field selection; selection never widens.

**3. Never filterable, never sortable.** Not deferred — rejected. A
computed field never joins the derived `filterable`/`sortable` allowlists,
and naming one in a configured `allowlists.filterable`/`sortable` is a
bootstrap `ConfigurationException`. In-memory post-fetch filtering is not
a future option here; a caller who needs to filter or sort on a derived
value wants a real generated column, which every supported ORM already
offers.

**4. Never writable.** `DefaultDeserializer` strips computed names from
every write payload. Keeping them out of the derived writable projection
is _not_ sufficient on its own: a registered `create`/`update` DTO
replaces that projection wholesale (`dtoShapeKeys(dto) ??
this.writableProjection`), so a DTO class declaring the field for
documentation would otherwise pass the key through to the adapter as if it
were a column. The strip is explicit and applies whichever projection is
in force.

Further declarations are bootstrap errors for the same
fail-fast-with-the-key-path reason: a computed name colliding with a real
column or relation (the shadowed value would silently vanish from every
response), a descriptor with no `resolve` function, and the name
`__proto__`, which is not an ordinary object key and would disappear from
the resolved map without a word.

`computed` carries functions, so — like `dto` and `relations` — it is
**entity-scope structural config, outside the settings precedence chain**:
it is absent from `SETTINGS_KEYS`, never merged global → entity →
operation, and unreachable from a per-call `KavoCallOptions.settings`
override.

At the type level, `EntityConfig` takes an eighth parameter, `Computed`,
inferred from the keys of `computed`. It widens `allowlists.selectable`
to `FieldPath<Entity> | Computed` so an explicit selectable list can name
a computed field without a cast — and, deliberately, widens nothing else,
so rule 3 is a compile error before it is a bootstrap error.

## Consequences

- A computed field on a relation **target** works with no extra machinery:
  the serializer already resolves an included node's projection from the
  target's own `ResolvedEntityConfig` through the `EntityCatalog`, and
  that config now carries `computed`. A relation still cannot widen what
  its target exposes.
- What that composition does **not** give it is a context of its own. One
  response is one request, and `KavoContext` describes that request, so a
  target's resolver is handed the _root_ operation's context:
  `GET /posts/1?include=author` gives an `Author` computed field a context
  whose `entityName`, `operation`, `config` and `query` are Post's. Only
  the request-scoped members — `principal`, `correlationId`,
  `transaction`, `state` — are meaningful from a relation target. A
  per-target context was rejected as a worse lie: it would have to invent
  an `operation` that no caller issued and a `query` that was never
  normalized against that entity.
- `selectable: false` narrows the allowlist, not the projection. The field
  stays in the default response and its name becomes a 400 in `fields=`;
  a request that sends any fieldset still drops it, with no way to ask for
  it back. That follows from rule 2 rather than contradicting it —
  selection narrows uniformly — but it is the one place the flag's name
  reads as a stronger promise than it makes.
- `ResolvedEntityConfig` gains a required `computed` member. It is
  produced by Kavo and read by the serializer/deserializer; anything
  constructing one by hand has to supply it.
- Static typing of the _response_ is unchanged: the entity-derived
  `ItemDto` does not grow the computed key. A caller wanting the field
  statically typed registers an `item`/`list` DTO naming it, exactly as
  for any other narrowing today. Deriving it automatically was considered
  and left out — it would mean synthesizing a response type from a config
  value, which every other DTO slot deliberately does not do.
- The extension point, if a later version wants derived values the
  database can filter on: that is a generated column, declared through
  the ORM and surfaced by the metadata seam as an ordinary field — not a
  second mode of this feature.
