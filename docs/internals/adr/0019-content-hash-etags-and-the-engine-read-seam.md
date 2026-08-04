# ADR-0019 — ETags are content hashes of the representation, and preconditions are evaluated by the engine through its own reader

**Status:** accepted (issue #120)

## Context

Conditional requests need two things Kavo did not have: a value that
identifies the current state of a resource, and a place to compare an
incoming `If-Match` against it before a write is applied.

For the **value**, the obvious alternative is a version or `updatedAt`
column, declared in config and read from the row. It is stronger — the
adapter could fold it into the `UPDATE ... WHERE version = ?` and get a
real compare-and-swap — but it lands in every ORM adapter at once
(`@kavo/typeorm`, `@kavo/prisma`, `@kavo/mongoose`, `@kavo/mikroorm`),
needs a migration story per adapter, and asks every entity to carry a
column it may not want. A hash of the serialized representation needs
none of that: the representation is already being produced, and hashing
it is pure.

For the **place**, the engine's lifecycle had no read of its own.
`KavoEngineDependencies` carried no adapter and no reader
(`kavo-engine.ts`); the adapter is closed over privately inside
`builtInHandlers`, and `updateOne`/`patchOne`/`deleteOne` each call
straight through to `adapter.update`/`patch`/`delete` with no pre-read at
all. So "compare the target's current ETag" had nowhere to live.
Pushing it down into the handlers does not work either: a handler has
the adapter but not the serializer, and the tag is a hash of the
_serialized_ representation, not of the entity row.

Two further tensions come with the hash approach:

- A hash depends on key order unless something makes it not. A DTO field
  reorder would otherwise silently invalidate every cached copy.
- An ETag identifies a **representation**, not a resource (RFC 9110
  §8.8.3). `GET /users/1?select=name` and `GET /users/1` are different
  representations, so hashing what is actually sent gives them different
  tags — which is correct, and also means the tag from a narrowed read
  cannot be used as an `If-Match` token, because a write has no
  `select` to narrow by.

## Decision

**1. The ETag is a SHA-256 of the canonicalized serialized
representation.** `computeEtag` (`core/src/caching/etag.ts`) canonicalizes
with object keys **sorted** before hashing, so the tag depends on content
and not on the order a DTO projection produced. SHA-256 rather than a
cheap non-cryptographic hash because for `If-Match` a collision is a
silently lost update. Web Crypto and `TextEncoder` are reached through a
typed `globalThis` accessor, the way `randomUuid` already reaches
`crypto.randomUUID` — a `node:crypto` import would violate ADR-0005 and
fail `pnpm depcruise`, not merely bend a convention.

**2. Tags are per representation.** A response's `etag` is the hash of
that response's own serialized item, so `select`/`include` change it.
Collection responses (`findMany`) carry none — a list's identity spans
pagination, sort and filter, which is a different feature.

**3. `KavoEngineDependencies` gains a `reader: EntityReader<Entity>`,**
and the engine — not a handler — evaluates `If-Match`. It performs the
pre-read itself, immediately before handler execution, and hashes the
entity's **canonical read representation**: what `findOne` on that id
with no query params would return (`normalizeInput(undefined, config)`,
the `item` DTO resolved for `findOne`). That is the representation an
`If-Match` token came from, so it is the one the token is compared
against. `createCrud` already holds the adapter, which is both halves, so
the wiring costs nothing.

**4. The precondition applies to `updateOne`, `patchOne`, and
`deleteOne`.** `restoreOne`/`purgeOne` are excluded: both act on a
_soft-deleted_ row (ADR-0013), which the canonical read excludes, so a
pre-read would raise `NotFoundException` for a row the operation itself
would have found. A missing target is always a 404, never a 412 — a
precondition is a statement about a representation, and there is none.

**5. `If-None-Match` is answered for reads only.** A matching tag sets
`KavoResponse.notModified`; `item` stays populated, because a content
hash cannot be known without serializing and so there is no work to skip.
The transport decides what to do with it — `@kavo/nest` answers `304`
with no body. On a write, RFC 9110 gives `If-None-Match` "only if absent"
semantics, which is a conditional-create feature this decision
deliberately leaves out rather than half-implements.

**6. `caching.etag` gates both halves at once.** One key, resolved
through the ordinary precedence chain (doc 08): `false` at any scope
computes no tag _and_ ignores both conditional headers, rather than
leaving a check running against a value nothing produces.

## Consequences

- **This is check-then-write, not compare-and-swap.** Between the
  pre-read and the adapter's write there is a real race window: two
  writers can both pass the check and the second silently wins. It
  narrows the window that a naive last-write-wins API leaves wide open;
  it does not close it. A version column with adapter-level conditional
  writes is the change that would, and it is deliberately out of scope —
  if it ever lands, it supersedes point 1 here, not the reader seam.
- **An `If-Match` token must come from an unnarrowed read.** An ETag
  taken from `GET /users/1?select=name` identifies a different
  representation and will not match the canonical one, so it 412s. This
  is spec-conformant and surprising in equal measure, which is why it is
  documented for adopters and not only here.
- **`KavoEngineDependencies` gained a required member.** Anything
  constructing a `KavoEngine` by hand must now supply a reader; in-repo
  that is only `createKavo`.
- **`KavoResponse` gained `etag` and `notModified`.** Both are always
  present, so a transport never has to guess whether the engine
  considered caching; code that _constructs_ a `KavoResponse` (a fake
  engine in a test, a custom transport) must supply them.
- The pre-read is one extra `findOneById` per write **that carries an
  `If-Match`**. A request with no precondition pays nothing, and the
  hash on a response costs one SHA-256 over a representation that was
  going to be serialized regardless.
