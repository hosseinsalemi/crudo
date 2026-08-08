import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKavo } from "@kavo/core";
import { createSseTransport, type SseTransport } from "@kavo/sse";
import { Book, bookMetadata, InMemoryBookAdapter } from "./support/book-fixture.js";

/**
 * The acceptance criterion's own words: "a real HTTP client consuming the
 * text/event-stream response against a running transport wired to an
 * in-memory Kavo instance". A real `http.Server` plus the platform's own
 * `fetch`, not a mocked request/response — `sse-transport.spec.ts` covers
 * the same logic in isolation with fakes; this suite is what proves the
 * wiring actually works over a socket.
 */

function readSseFrames(body: ReadableStream<Uint8Array>): { next(): Promise<string>; cancel(): Promise<void> } {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function next(): Promise<string> {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before a full SSE frame arrived");
      buffer += decoder.decode(value, { stream: true });
    }
    const end = buffer.indexOf("\n\n") + 2;
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end);
    return frame;
  }

  return { next, cancel: () => reader.cancel() };
}

describe("@kavo/sse — end-to-end over a real HTTP server", () => {
  let server: Server;
  let baseUrl: string;
  let transport: SseTransport;
  let adapter: InMemoryBookAdapter;

  beforeEach(async () => {
    adapter = new InMemoryBookAdapter();
    transport = createSseTransport({
      verifyToken: (token) => (token === "good-token" ? { sub: "u1" } : null),
      subscribableFields: (entity) => (entity === "Book" ? ["title", "status"] : undefined),
    });

    server = createServer((req, res) => {
      void transport.handleRequest(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    transport.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects with 401 and never opens the stream when the token is missing or invalid", async () => {
    const response = await fetch(`${baseUrl}/realtime?channel=Book.1`, {
      headers: { Accept: "text/event-stream" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(transport.connectionCount).toBe(0);
  });

  it("rejects a 'fields' request naming a field outside subscribableFields with 400", async () => {
    const response = await fetch(`${baseUrl}/realtime?channel=Book.1&token=good-token&fields=title,price`, {
      headers: { Accept: "text/event-stream" },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("price");
    expect(transport.connectionCount).toBe(0);
  });

  it("delivers a created event as a spec-correct SSE frame to a connected subscriber", async () => {
    const kavo = createKavo({ realtimeTransports: [transport] });
    const crud = kavo.createCrud(Book, { realtime: { enabled: true, events: {} } } as never, {
      adapter,
      metadata: bookMetadata,
    });

    const response = await fetch(`${baseUrl}/realtime?channel=Book.1&token=good-token`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const frames = readSseFrames(response.body!);
    // Book.1: this adapter's ids start at 1, and this is the first write —
    // an entity-level SSE channel is exactly `<entity>.<id>`, known ahead of
    // the write only because nothing else has created a Book yet.
    await crud.createOne({ title: "Dune", status: "draft", price: 999 } as never);

    const frame = await frames.next();
    frames.cancel();

    expect(frame).toMatch(/^id: \d+\n/);
    expect(frame).toContain("event: created\n");

    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "))!;
    const event = JSON.parse(dataLine.slice("data: ".length)) as {
      event: string;
      entity: string;
      channel: string;
      item: { title: string };
    };
    expect(event.event).toBe("created");
    expect(event.entity).toBe("Book");
    expect(event.channel).toBe("Book.1");
    expect(event.item).toMatchObject({ title: "Dune" });
  });
});
