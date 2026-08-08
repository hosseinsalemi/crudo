import type { IncomingMessage, ServerResponse } from "node:http";
import type { RealtimeEventDto, RealtimeFieldSelector, RealtimeTransport } from "@kavo/core";

/**
 * Bytes buffered in a connection's underlying socket before it is dropped
 * rather than blocking `publish` for every other subscriber. `res.
 * writableLength` (Node's `http.ServerResponse` is a `stream.Writable`) is
 * the amount queued but not yet flushed to the OS — a slow reader grows
 * this, a healthy one keeps it near zero. 64 KiB is generous for
 * `RealtimeEventDto`-sized JSON frames while still catching a genuinely
 * stuck client quickly.
 */
const DEFAULT_BUFFER_LIMIT_BYTES = 64 * 1024;

/** What `handleRequest` needs to authenticate and scope one subscription. */
export interface SseTransportOptions {
  /**
   * Authenticates a subscribe request the same way REST does: a bearer
   * token, read from the `Authorization` header or a `token` query param
   * (`EventSource` cannot set custom headers, so the query param is the
   * only option a browser client actually has). Returning `null` (or
   * `undefined`) fails the request with `401` *before* any SSE frame is
   * written — `handleRequest` never opens the stream on an invalid or
   * missing token. The resolved value is only used to gate the connection;
   * `@kavo/sse` carries no `authorize` seam (out of scope for this issue,
   * see `RealtimeTransport`'s own doc on subscriber-level access control).
   */
  verifyToken(token: string): unknown | Promise<unknown>;
  /**
   * Per-entity `RealtimeSettings.subscribableFields`, the same allowlist an
   * app already configured via `createCrud` — this package has no config
   * resolution of its own, so the caller supplies the lookup. A request
   * naming a `fields` query param outside the allowlist is rejected with
   * `400` before the stream opens, the same way `allowlists.selectable`
   * rejects an unlisted field over REST. Returning `undefined` (including
   * when the callback itself is omitted) means no allowlist is configured
   * for that entity, so any requested field is accepted.
   */
  subscribableFields?(entityName: string): RealtimeFieldSelector | undefined;
  /** See `DEFAULT_BUFFER_LIMIT_BYTES`. */
  bufferLimitBytes?: number;
}

/** A `RealtimeTransport` plus the HTTP entry point a host wires a route to. */
export interface SseTransport extends RealtimeTransport {
  /**
   * Handles one incoming SSE subscribe request: `GET ?channel=<entity>.<id>`
   * with `Accept: text/event-stream`. Host-framework-agnostic — takes
   * Node's own `IncomingMessage`/`ServerResponse`, which every Node HTTP
   * framework's request/response either extends or wraps directly.
   * Resolves once the response is settled (an error status was written, or
   * the stream was opened) — the connection itself then lives for as long
   * as the client keeps it open, torn down by the request's own `close`.
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Number of currently open subscriptions, across every channel. */
  readonly connectionCount: number;
  /** Ends every open connection and forgets them. For graceful shutdown and tests. */
  close(): void;
}

interface Connection {
  readonly res: ServerResponse;
  readonly channel: string;
}

/**
 * Same array-or-`exclude` semantics `resolveFieldSelector` (core,
 * internal) applies for REST's `selectable`/`filterable`/`sortable` — but
 * with no "base" field list to fall back on, because `RealtimeFieldSelector`
 * carries none (`settings.ts`'s own doc on why: this schema has no `Entity`
 * type parameter to check a field name against). An explicit array is a
 * positive allowlist; `{ exclude }` is checked negatively instead — "not
 * excluded" rather than "in some base set minus excluded" — since there is
 * no base set here to subtract from.
 */
function isFieldAllowed(selector: RealtimeFieldSelector | undefined, field: string): boolean {
  if (selector === undefined) return true;
  // `"exclude" in selector`, not `Array.isArray` — `Array.isArray`'s guard is
  // `arg is any[]`, and a `readonly string[]` is not assignable to `any[]`,
  // so it fails to narrow the union in the negative branch. Same reason
  // core's own `resolveFieldSelector` (resolve-entity-config.ts) checks it
  // this way.
  if ("exclude" in selector) return !selector.exclude.includes(field);
  return selector.includes(field);
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * `id:` set even though nothing consumes it yet (resume-on-reconnect is a
 * future issue) — a monotonically increasing counter, shared across every
 * channel on this transport instance, so it stays meaningful the day resume
 * is built instead of forcing a wire-format change then.
 */
function frame(id: number, event: RealtimeEventDto): string {
  return `id: ${id}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * The first real `RealtimeTransport` implementation (issue #155, over the
 * seam #154 added): plain HTTP `text/event-stream`, no client or server
 * library required. Entity-level subscriptions only — the channel a
 * connection opens is exactly the `<entity>.<id>` string `RealtimeEventDto.
 * channel` carries, and `publish` fans an event out to every connection
 * registered under that same string.
 *
 * One process, one in-memory channel registry: a subscriber connected to
 * this instance never sees a write handled by another instance of a
 * horizontally-scaled app (see the package README's "Known limitations").
 */
export function createSseTransport(options: SseTransportOptions): SseTransport {
  const bufferLimitBytes = options.bufferLimitBytes ?? DEFAULT_BUFFER_LIMIT_BYTES;
  const channels = new Map<string, Set<Connection>>();
  let nextEventId = 1;

  function subscribe(connection: Connection): void {
    let subscribers = channels.get(connection.channel);
    if (!subscribers) {
      subscribers = new Set();
      channels.set(connection.channel, subscribers);
    }
    subscribers.add(connection);
  }

  function unsubscribe(connection: Connection): void {
    const subscribers = channels.get(connection.channel);
    if (!subscribers) return;
    subscribers.delete(connection);
    if (subscribers.size === 0) channels.delete(connection.channel);
  }

  return {
    name: "sse",

    get connectionCount(): number {
      let total = 0;
      for (const subscribers of channels.values()) total += subscribers.size;
      return total;
    },

    async publish(event: RealtimeEventDto): Promise<void> {
      const subscribers = channels.get(event.channel);
      if (!subscribers || subscribers.size === 0) return;

      const payload = frame(nextEventId++, event);
      // Direct `for...of` over the live `Set`, not a snapshot copy: deleting
      // the current entry mid-iteration (the `unsubscribe` below, for a
      // connection that can't keep up) is well-defined under the Set
      // iteration protocol — already-visited and about-to-be-visited
      // entries are unaffected.
      for (const connection of subscribers) {
        if (connection.res.writableLength > bufferLimitBytes) {
          // Can't keep up: dropped rather than left to block publish to
          // every other subscriber of this channel.
          unsubscribe(connection);
          connection.res.end();
          continue;
        }
        connection.res.write(payload);
      }
    },

    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== "GET") {
        sendJson(res, 400, { error: "SSE subscription requires GET" });
        return;
      }
      const accept = req.headers.accept;
      if (typeof accept !== "string" || !accept.includes("text/event-stream")) {
        sendJson(res, 400, { error: "requires 'Accept: text/event-stream'" });
        return;
      }

      const url = new URL(req.url ?? "", "http://kavo.invalid");
      const channel = url.searchParams.get("channel");
      const dot = channel?.indexOf(".") ?? -1;
      if (!channel || dot <= 0 || dot === channel.length - 1) {
        sendJson(res, 400, { error: "a 'channel' query parameter of the form '<entity>.<id>' is required" });
        return;
      }

      const token = bearerToken(req) ?? url.searchParams.get("token") ?? undefined;
      let principal: unknown = null;
      if (token !== undefined) {
        try {
          principal = (await options.verifyToken(token)) ?? null;
        } catch {
          principal = null;
        }
      }
      if (principal === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      const entityName = channel.slice(0, dot);
      const fieldsParam = url.searchParams.get("fields");
      if (fieldsParam !== null) {
        const selector = options.subscribableFields?.(entityName);
        const requested = fieldsParam
          .split(",")
          .map((field) => field.trim())
          .filter((field) => field.length > 0);
        const disallowed = requested.filter((field) => !isFieldAllowed(selector, field));
        if (disallowed.length > 0) {
          sendJson(res, 400, { error: `field(s) not subscribable: ${disallowed.join(", ")}` });
          return;
        }
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();

      const connection: Connection = { res, channel };
      subscribe(connection);
      req.on("close", () => unsubscribe(connection));
      res.on("error", () => unsubscribe(connection));
    },

    close(): void {
      for (const subscribers of channels.values()) {
        for (const connection of subscribers) connection.res.end();
      }
      channels.clear();
    },
  };
}
