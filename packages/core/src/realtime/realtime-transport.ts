import type { RealtimeEventDto } from "./realtime-event.js";

/**
 * A sink a realtime event is published to — WebSocket, SSE, a message
 * broker, or anything else. `@kavo/core` defines only this seam and ships
 * no implementation (ADR-0005: core has zero runtime dependencies, and a
 * transport library is exactly the kind of dependency that stays out).
 *
 * `publish` rejecting never fails the mutation that produced the event —
 * the engine catches and logs it. A transport that needs at-least-once
 * delivery semantics is responsible for its own retry/durability; the
 * engine calls `publish` once per event, per transport.
 */
export interface RealtimeTransport {
  /** Identifies the transport in logs — e.g. `"websocket"`, `"sse"`. */
  readonly name: string;
  publish(event: RealtimeEventDto): Promise<void>;
}
