# @kavo/sse

The first `RealtimeTransport` implementation (`@kavo/core`, ADR-0023):
plain HTTP `text/event-stream`, no client or server library required —
SSE is one-directional, so there is no socket to open and nothing to
depend on beyond Node's own `http` types.

**May depend on:** `@kavo/core` only, no peer. **Never on:** `@kavo/nest`
or any other framework — same rule `packages/orms/*` follows.

## Usage

```ts
import { createSseTransport } from "@kavo/sse";
import { createKavo } from "@kavo/core";

// Filled in below, after `createCrud` — the callback only runs once a
// subscribe request actually arrives, so the forward reference is fine.
let bookService: ReturnType<typeof kavo.createCrud<Book>>;

const sse = createSseTransport({
  verifyToken: (token) => verifyJwt(token), // returns a principal, or null
  subscribableFields: (entityName) => (entityName === "Book" ? ["title", "status", "price"] : undefined),
  // Enables subscribe-time filtering (issue #160) for an entity — omit an
  // entry and a `filter[...]` query param on that entity is rejected with
  // 400 rather than silently ignored. Typically `service.engine.metadata`/
  // `service.engine.config` off the `createCrud` service already returned.
  filterableEntities: (entityName) =>
    entityName === "Book" ? { metadata: bookService.engine.metadata, config: bookService.engine.config } : undefined,
});

const kavo = createKavo({
  infrastructure,
  realtimeTransports: [sse],
  defaults: {
    realtime: { enabled: true, events: { created: true, updated: true, patched: true, deleted: true } },
  },
});

bookService = kavo.createCrud(Book);
```

`verifyToken` is optional — omit it and `handleRequest` never authenticates
a subscribe request at all (no `401`, no `token`/`Authorization` check),
useful for an internal-only or already-perimeter-authenticated stream:

```ts
const sse = createSseTransport({}); // no verifyToken: every subscribe request is accepted
```

Mount `sse.handleRequest` on a plain Node HTTP route (or any host
framework's request/response — Express, Nest, Fastify's raw
req/res, … — since `IncomingMessage`/`ServerResponse` is what all of
them extend or wrap):

```ts
http.createServer((req, res) => {
  if (req.url?.startsWith("/realtime")) {
    void sse.handleRequest(req, res);
    return;
  }
  // ... the rest of the app's routing
});
```

A client subscribes to one entity/id, or to the whole entity, with
`EventSource` (or any HTTP client that reads a chunked `text/event-stream`
body):

```js
// Item channel: every event for Book id 42.
const one = new EventSource("/realtime?channel=Book.42&token=...");

// Collection channel: every event for every Book (issue #160).
const all = new EventSource("/realtime?channel=Book&token=...");

// Collection channel, scoped with the same filter grammar REST uses.
const published = new EventSource("/realtime?channel=Book&filter[status][eq]=published&token=...");

all.addEventListener("updated", (message) => {
  const event = JSON.parse(message.data); // RealtimeEventDto
});
```

`channel` is required: `<entity>.<id>` for an item-level subscription, or
the bare `<entity>` for a collection-level one (every event for that
entity). A collection-channel subscribe request may add a `filter` query
string in the exact `filter[field][operator]=value` grammar REST list
requests use (doc 18) — evaluated in memory per event, no DB round trip.
Filtering is opt-in per entity via `filterableEntities`; an entity with no
entry there rejects any `filter[...]` param with `400` rather than
silently ignoring it. See doc 18 §4.3 for what a filtered subscriber
receives when a write moves a row across the filter boundary, and for the
unconditional `"deleted"`-event bypass.

`token` may be passed as a query param (what `EventSource` needs, since it
cannot set custom headers) or as a normal `Authorization: Bearer <token>`
header for any other client. An invalid or missing token gets a `401`
_before_ any SSE frame is written — unless `verifyToken` was omitted from
`createSseTransport`, in which case `token` is ignored entirely and every
subscribe request is accepted. Once `subscribableFields` is configured
for an entity, it bounds every outgoing `item` **unconditionally** — not
only when a subscriber names `fields` — the same way `allowlists.selectable`
bounds a REST response whether or not the caller asked for a subset. An
optional `fields` query param (comma-separated) narrows further within
that bound; a field outside it (or outside `subscribableFields`, when no
`fields` param is given) gets a `400` the same way `allowlists.selectable`
rejects an unlisted field over REST.

A connection that cannot keep up with its publish rate (the writable
buffer on its response exceeds `bufferLimitBytes`, default 64 KiB) is
closed rather than left to block delivery to every other subscriber.

## Known limitations

- **No resume-on-reconnect.** Every SSE frame carries an `id:`, but
  nothing reads `Last-Event-ID` yet — a dropped connection means missed
  events, not replayed ones. This matters more for SSE than it will for
  `@kavo/websocket`: browsers' native `EventSource` **auto-reconnects by
  default** on a dropped connection, with no application code asking for
  it, so a client silently starts receiving only new events after a gap it
  never signaled. Building resume via the `since` cursor is a future issue.
- **No multi-node fan-out.** The channel registry is one process's
  in-memory `Map` — a subscriber connected to one instance of a
  horizontally-scaled app never sees a write handled by another instance.
- **No "leave" event on an ordinary write.** A write that makes a row stop
  matching a filtered subscriber's filter is not delivered at all — only a
  genuine `"deleted"` reliably tells that subscriber a row is gone. See
  doc 18 §4.3.
- **No filtering by which fields changed** — a subscribe-time filter
  matches row data (`RealtimeEventDto.item`), not the write's diff
  (`RealtimeEventDto.changed`).
- **No subscriber-level authorization.** Every subscription within
  `subscribableFields` is trusted once the connection is authenticated (or
  unconditionally, if `verifyToken` was omitted); row-level/tenant scoping
  of subscribers is a future issue (`authorize`, out of scope here — see
  `RealtimeTransport`'s own doc). A `filter` narrows _which_ events a
  subscriber receives, not _whether_ they were authorized to receive them.
