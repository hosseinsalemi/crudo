import { describe, expect, it, vi } from "vitest";
import type { RealtimeEventDto } from "@kavo/core";
import { createSseTransport } from "@kavo/sse";
import { fakeRequest, fakeResponse, setWritableLength } from "./support/fake-http.js";

function createdEvent(overrides: Partial<RealtimeEventDto> = {}): RealtimeEventDto {
  return {
    event: "created",
    entity: "Book",
    id: 1,
    channel: "Book.1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    item: { id: 1, title: "Dune" },
    ...overrides,
  };
}

describe("createSseTransport — name", () => {
  it("identifies itself as 'sse'", () => {
    expect(createSseTransport({ verifyToken: () => ({}) }).name).toBe("sse");
  });
});

describe("createSseTransport — handleRequest auth", () => {
  it("rejects with 401 before opening the stream when no token is supplied", async () => {
    const transport = createSseTransport({ verifyToken: () => ({ sub: "u1" }) });
    const { req } = fakeRequest("/realtime?channel=Book.1", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.frames).toHaveLength(0);
    expect(transport.connectionCount).toBe(0);
  });

  it("rejects with 401 when verifyToken returns null", async () => {
    const transport = createSseTransport({ verifyToken: () => null });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=bad", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toMatchObject({ error: expect.any(String) });
  });

  it("rejects with 401 when verifyToken rejects", async () => {
    const transport = createSseTransport({
      verifyToken: () => Promise.reject(new Error("token service down")),
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=whatever", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(401);
  });

  it("rejects with 401 when verifyToken throws synchronously", async () => {
    const transport = createSseTransport({
      verifyToken: () => {
        throw new Error("malformed token");
      },
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=whatever", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(401);
  });

  it("reads the token from a query param — what EventSource can actually set", async () => {
    const verifyToken = vi.fn().mockReturnValue({ sub: "u1" });
    const transport = createSseTransport({ verifyToken });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=abc123", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(verifyToken).toHaveBeenCalledWith("abc123");
    expect(res.statusCode).toBe(200);
  });

  it("prefers the Authorization header over a token query param when both are present", async () => {
    const verifyToken = vi.fn().mockReturnValue({ sub: "u1" });
    const transport = createSseTransport({ verifyToken });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=from-query", {
      accept: "text/event-stream",
      authorization: "Bearer from-header",
    });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(verifyToken).toHaveBeenCalledWith("from-header");
  });
});

describe("createSseTransport — handleRequest request shape", () => {
  it("rejects a non-GET method with 400 before opening the stream", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" });
    (req as { method: string }).method = "POST";
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(400);
  });

  it("rejects a request with no 'Accept: text/event-stream' header with 400", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "application/json" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(400);
  });

  it("rejects a request with no 'channel' query parameter with 400", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?token=t", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(400);
  });

  it.each(["", ".42", "Book.", "Book"])("rejects a malformed channel %j with 400", async (channel) => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest(`/realtime?channel=${encodeURIComponent(channel)}&token=t`, {
      accept: "text/event-stream",
    });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(400);
  });
});

describe("createSseTransport — subscribableFields enforcement", () => {
  it("accepts a 'fields' request naming only allowlisted fields (array form)", async () => {
    const transport = createSseTransport({
      verifyToken: () => ({}),
      subscribableFields: (entity) => (entity === "Book" ? ["title", "status"] : undefined),
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t&fields=title,status", {
      accept: "text/event-stream",
    });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(200);
  });

  it("rejects a 'fields' request naming a field outside the allowlist (array form) with 400", async () => {
    const transport = createSseTransport({
      verifyToken: () => ({}),
      subscribableFields: (entity) => (entity === "Book" ? ["title", "status"] : undefined),
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t&fields=title,price", {
      accept: "text/event-stream",
    });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: expect.stringContaining("price") });
    expect(transport.connectionCount).toBe(0);
  });

  it("rejects a field named in an 'exclude' selector with 400", async () => {
    const transport = createSseTransport({
      verifyToken: () => ({}),
      subscribableFields: () => ({ exclude: ["price"] }),
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t&fields=price", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(400);
  });

  it("accepts a field not named by an 'exclude' selector", async () => {
    const transport = createSseTransport({
      verifyToken: () => ({}),
      subscribableFields: () => ({ exclude: ["price"] }),
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t&fields=title", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(200);
  });

  it("accepts any field when no subscribableFields callback is configured", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t&fields=anything", {
      accept: "text/event-stream",
    });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(200);
  });

  it("accepts any field when the callback returns undefined for that entity", async () => {
    const transport = createSseTransport({
      verifyToken: () => ({}),
      subscribableFields: () => undefined,
    });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t&fields=anything", {
      accept: "text/event-stream",
    });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(200);
  });

  it("skips field validation entirely when no 'fields' param is given", async () => {
    const subscribableFields = vi.fn().mockReturnValue([]);
    const transport = createSseTransport({ verifyToken: () => ({}), subscribableFields });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(200);
    expect(subscribableFields).not.toHaveBeenCalled();
  });
});

describe("createSseTransport — opening a stream", () => {
  it("writes text/event-stream response headers and registers the connection", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(false);
    expect(res.headers).toMatchObject({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(transport.connectionCount).toBe(1);
  });

  it("unsubscribes the connection once the underlying request closes", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req, close } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);
    expect(transport.connectionCount).toBe(1);

    close();
    expect(transport.connectionCount).toBe(0);
  });

  it("unsubscribes the connection once the underlying response errors", async () => {
    // The other half of cleanup, alongside the request's own 'close' above —
    // a broken pipe surfaces as an 'error' on the response, not a 'close' on
    // the request, and both must free the connection or a channel accumulates
    // dead subscribers forever.
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" });
    const res = fakeResponse();

    await transport.handleRequest(req, res);
    expect(transport.connectionCount).toBe(1);

    res.emit("error", new Error("ECONNRESET"));
    expect(transport.connectionCount).toBe(0);
  });
});

describe("createSseTransport — publish", () => {
  it("writes a spec-correct SSE frame (id/event/data) to a subscriber of the matching channel", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" });
    const res = fakeResponse();
    await transport.handleRequest(req, res);

    const event = createdEvent();
    await transport.publish(event);

    expect(res.frames).toHaveLength(1);
    const frame = res.frames[0]!;
    expect(frame).toMatch(/^id: \d+\n/);
    expect(frame).toContain(`event: ${event.event}\n`);
    expect(frame).toContain(`data: ${JSON.stringify(event)}\n`);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("does not deliver to a connection subscribed to a different channel", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const { req } = fakeRequest("/realtime?channel=Book.2&token=t", { accept: "text/event-stream" });
    const res = fakeResponse();
    await transport.handleRequest(req, res);

    await transport.publish(createdEvent({ channel: "Book.1" }));

    expect(res.frames).toHaveLength(0);
  });

  it("is a no-op when no connection is subscribed to the event's channel", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    await expect(transport.publish(createdEvent())).resolves.toBeUndefined();
  });

  it("fans one event out to every connection subscribed to the same channel", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const first = fakeResponse();
    const second = fakeResponse();
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" }).req,
      first,
    );
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" }).req,
      second,
    );

    await transport.publish(createdEvent());

    expect(first.frames).toHaveLength(1);
    expect(second.frames).toHaveLength(1);
    // Same payload delivered to both, not just the same count — a fan-out
    // bug that mutated per-connection state or reused a stale event object
    // would still pass a length-only assertion.
    expect(second.frames[0]).toBe(first.frames[0]);
  });

  it("assigns increasing 'id:' values across successive publishes, shared across channels", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const bookRes = fakeResponse();
    const authorRes = fakeResponse();
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" }).req,
      bookRes,
    );
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Author.5&token=t", { accept: "text/event-stream" }).req,
      authorRes,
    );

    await transport.publish(createdEvent({ channel: "Book.1" }));
    await transport.publish(createdEvent({ entity: "Author", id: 5, channel: "Author.5" }));

    const idOf = (frame: string) => Number(/^id: (\d+)/.exec(frame)![1]);
    // One counter shared across every channel on the transport, not a
    // per-channel one — the second publish landed on a different channel's
    // connection entirely, and its id must still be greater.
    expect(idOf(authorRes.frames[0]!)).toBeGreaterThan(idOf(bookRes.frames[0]!));
  });

  it("drops a connection whose write buffer exceeds bufferLimitBytes instead of blocking other subscribers", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}), bufferLimitBytes: 10 });
    const slow = fakeResponse();
    const healthy = fakeResponse();
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" }).req,
      slow,
    );
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" }).req,
      healthy,
    );
    setWritableLength(slow, 1_000_000);

    expect(transport.connectionCount).toBe(2);
    await transport.publish(createdEvent());

    expect(slow.frames).toHaveLength(0);
    expect(slow.ended).toBe(true);
    expect(healthy.frames).toHaveLength(1);
    expect(transport.connectionCount).toBe(1);
  });
});

describe("createSseTransport — close", () => {
  it("ends every open connection and clears the registry", async () => {
    const transport = createSseTransport({ verifyToken: () => ({}) });
    const res = fakeResponse();
    await transport.handleRequest(
      fakeRequest("/realtime?channel=Book.1&token=t", { accept: "text/event-stream" }).req,
      res,
    );
    expect(transport.connectionCount).toBe(1);

    transport.close();

    expect(res.ended).toBe(true);
    expect(transport.connectionCount).toBe(0);
  });
});
