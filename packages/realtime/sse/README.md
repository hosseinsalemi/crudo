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

const sse = createSseTransport({
  verifyToken: (token) => verifyJwt(token), // returns a principal, or null
  subscribableFields: (entityName) => (entityName === "Book" ? ["title", "status", "price"] : undefined),
});

const kavo = createKavo({
  infrastructure,
  realtimeTransports: [sse],
  defaults: {
    realtime: { enabled: true, events: { created: true, updated: true, patched: true, deleted: true } },
  },
});
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

A client subscribes to one entity/id with `EventSource`, or any HTTP
client that reads a chunked `text/event-stream` body:

```js
const source = new EventSource("/realtime?channel=Book.42&token=...");
source.addEventListener("updated", (message) => {
  const event = JSON.parse(message.data); // RealtimeEventDto
});
```

`channel` is required and always `<entity>.<id>` — entity-level
subscriptions only; collection/view subscriptions are a future issue.
`token` may be passed as a query param (what `EventSource` needs, since it
cannot set custom headers) or as a normal `Authorization: Bearer <token>`
header for any other client. An invalid or missing token gets a `401`
_before_ any SSE frame is written. An optional `fields` query param
(comma-separated) is checked against that entity's configured
`realtime.subscribableFields`, if any — a field outside the allowlist gets
a `400`, the same way `allowlists.selectable` rejects an unlisted field
over REST; the field list does not filter what a subscription receives yet
(entity-level events are always the whole item), it only bounds what a
future field-scoped subscription could reach.

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
- **No subscriber-level authorization.** Every subscription within
  `subscribableFields` is trusted once the connection is authenticated;
  row-level/tenant scoping of subscribers is a future issue (`authorize`,
  out of scope here — see `RealtimeTransport`'s own doc).
