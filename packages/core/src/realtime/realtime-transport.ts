import type { RealtimeEventDto } from "./realtime-event.js";

/**
 * A sink a realtime event is published to — WebSocket, SSE, a message
 * broker, or anything else. `@kavo/core` defines only this seam and ships
 * no implementation (ADR-0005: core has zero runtime dependencies, and a
 * transport library is exactly the kind of dependency that stays out).
 *
 * `publish` rejecting never fails the mutation that produced the event —
 * the engine catches it and reports it through `RealtimeSettings.
 * onPublishError`, if the app supplied one (core has no ambient logger to
 * fall back on, ADR-0005). A transport that needs at-least-once delivery
 * semantics is responsible for its own retry/durability; the engine calls
 * `publish` once per event, per transport.
 *
 * **Authorization is entirely this transport's responsibility.** `publish`
 * receives the same whole-item `RealtimeEventDto` the writing principal's
 * own REST response was serialized from — core attaches no principal,
 * tenant, or per-subscriber scope to it, and `channel` is a bare
 * `<entity>.<id>` string with no access-control meaning of its own
 * (`subscribableFields` bounds which *fields* a subscription may reach,
 * once field-level subscriptions exist, but says nothing about *who*).
 * A transport that fans `channel` straight into a pub/sub topic without
 * checking, for each subscriber, whether that principal could have read
 * this row over REST will leak one principal's full item projection to
 * every subscriber of that entity/id. Row-level/tenant scoping of
 * subscribers (`authorize`) is deliberately out of this seam — see the
 * discussion on issue #154/#155 — until a future issue adds it.
 */
export interface RealtimeTransport {
  /** Identifies the transport in logs — e.g. `"websocket"`, `"sse"`. */
  readonly name: string;
  publish(event: RealtimeEventDto): Promise<void>;
}
