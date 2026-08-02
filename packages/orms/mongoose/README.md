# @kavo/mongoose

Mongoose adapter for Kavo: implements `RepositoryAdapter`
(`EntityReader` + `EntityWriter`) from `@kavo/core` over a Mongoose model.
`TransactionManager` is not implemented — see the `@remarks` on that
interface in `@kavo/core`.

**May depend on:** `@kavo/core`, `mongoose` (peer). **Never on:**
`@kavo/nest` or any framework.

Fully implemented: CRUD, filtering/sorting/pagination, soft delete
(explicit `softDelete.field` only — Mongoose declares no delete-marker
path the way TypeORM's `@DeleteDateColumn` does), and relation includes
(via `populate`) all run through this adapter.

## Usage

Unlike `@kavo/prisma`, there is nothing to declare twice. A Mongoose model
is already a constructor, so it _is_ the entity identity core needs, and
`connection.models` is the registry relation `ref`s resolve through — no
marker classes, no `entities` list. See
`docs/internals/adr/0018-mongoose-models-are-entity-identities.md`.

```ts
import mongoose, { Schema } from "mongoose";
import { createMongooseKavo } from "@kavo/mongoose";

const Author = mongoose.model("Author", new Schema({ name: String, email: String }));
const Book = mongoose.model(
  "Book",
  new Schema({ title: String, author: { type: Schema.Types.ObjectId, ref: "Author" } }),
);

await mongoose.connect(process.env.MONGO_URL!);
const kavo = createMongooseKavo(mongoose.connection);

const authors = kavo.createCrud(Author);
```

`createInfrastructure`/`createMongooseKavo` accept anything with a
`models` record: `mongoose`, `mongoose.connection`, or a
`mongoose.createConnection()` handle for a multi-database app.

## Ids are `_id`, and they are strings on the wire

MongoDB's `_id` is an `ObjectId`; core's `EntityId` is `string | number`.
This adapter converts at its own boundary, so **every id it returns is a
hex string** — including the `_id` of populated relations. The inbound
direction needs nothing: Mongoose casts a hex string back to an `ObjectId`
against the schema.

Responses therefore carry `_id`, not `id`. Mongoose's `id` virtual is not
used — virtuals are absent from `schema.paths` and are not applied to the
`lean` reads this adapter issues.

An id that is not a valid `ObjectId` is answered with **404**, not 500 or
400: a malformed id names a document that cannot exist, so it is treated
exactly like a well-formed id that isn't there.

Mongoose's `__v` version key is excluded from the entity description
entirely, so it never reaches a DTO or a response.

## Relation writes: explicit reference fields only

Per ADR-0014 ("associate by id, not deep writes"), a relation is set by
writing its reference field directly (`{ author: "652f…" }`), the same
contract the other adapters expose. Mongoose casts the hex string to an
`ObjectId` on the way in.

Note that Mongoose models a to-many edge as an **array of refs on the
parent** (`articles: [{ type: ObjectId, ref: "Article" }]`), the mirror
image of a SQL foreign key on the child. Kavo sees the same relation
descriptors either way.

## Known limitations

- **No relation-path filtering or sorting.** MongoDB resolves a dotted path
  inside a document, not across a `ref`, so `filter[author.name][eq]=Ada`
  raises `KAVO_QUERY_UNSUPPORTED_PARAM` (400) rather than quietly matching
  nothing. A path rooted at an _embedded subdocument_
  (`filter[address.city][eq]=Paris`) works natively. Lifting this needs an
  aggregation `$lookup`.
- **No virtual populate.** `schema.virtual(…, { ref, localField,
foreignField })` is invisible to `schema.paths`, so the metadata seam
  cannot see it. Use an array of refs, or a custom operation handler.
- **An un-included relation is omitted, not shown as its id.** A Mongoose
  ref path is the foreign key, but core's serializer emits a relation only
  when it is included, so `GET /books` shows no `author` at all (where
  `@kavo/typeorm` would show `authorId`). Filtering and sorting by the
  reference id _do_ work. Closing the rest needs a core change.
- **The soft-delete marker is writable.** Nothing in a Mongoose schema
  declares a delete column, so `deletedAt` is an ordinary field and a plain
  `PATCH` of it will soft-delete or revive a document, bypassing
  `deleteOne`'s already-deleted check. `@kavo/prisma` shares this; the fix
  belongs in core. Until then, register an explicit `update`/`patch` DTO
  that omits the marker if this matters to you.
- **`BigInt`/`Decimal128` are returned with JS number precision**, so a
  `Decimal128` beyond ~15 significant digits rounds. Returning them as
  strings would preserve precision but break filtering.
- **No transactions.** MongoDB sessions require a replica set; the
  `TransactionManager` seam is unbuilt across every Kavo adapter today.
- **`ValidationError` is not a 400.** A Mongoose schema-validation failure
  surfaces as `PersistenceException` (500) with the original error as
  `cause`. Core has no request-body validation code in its catalog, and an
  adapter should not mint one — see doc 15 §6.

## Soft delete and unique indexes

A soft-deleted document still occupies its unique indexes, so re-creating
"the same" document after a soft delete raises a 409 conflict — the honest
answer, since the value _is_ taken. The fix is a partial unique index
scoped to live documents:

```ts
schema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
```

Full design notes: [`docs/internals/architecture/15-mongoose-adapter.md`](../../../docs/internals/architecture/15-mongoose-adapter.md).
