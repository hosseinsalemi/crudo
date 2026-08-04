/**
 * ETag computation and conditional-request matching (RFC 9110 §8.8, §13.1).
 *
 * The tag is a **content hash of the serialized representation**, not a
 * version column read from the database — which is what keeps the whole
 * feature inside core plus the framework layer, with nothing asked of any
 * ORM adapter. The cost of that choice is stated plainly in ADR-0019: an
 * `If-Match` check is application-level check-then-write, never an atomic
 * compare-and-swap.
 */

/**
 * Incoming conditional-request tokens, transport-agnostic. Each entry is a
 * whole entity-tag as it appeared on the wire — `"abc"` (quotes included),
 * `W/"abc"`, or the wildcard `*` — because that is what the comparison
 * rules below are defined over. `@kavo/nest` parses these out of
 * `If-Match`/`If-None-Match`; a programmatic caller may pass them directly
 * on `KavoRequest.preconditions` or `KavoCallOptions.preconditions`.
 */
export interface RequestPreconditions {
  readonly ifMatch?: readonly string[];
  readonly ifNoneMatch?: readonly string[];
}

/** `If-Match: *` / `If-None-Match: *` — "any current representation". */
const WILDCARD = "*";

const WEAK_PREFIX = "W/";

/**
 * Web Crypto and `TextEncoder` are runtime globals on every supported
 * platform (Node ≥ 20, browsers, workers), but `@kavo/core` compiles
 * against pure ES lib types with zero imports (ADR-0005) — so they are
 * reached through a typed accessor, exactly the way `randomUuid` reaches
 * `crypto.randomUUID`. A `node:crypto` import would fail `pnpm depcruise`,
 * not merely bend a convention.
 */
interface WebGlobals {
  readonly crypto: {
    readonly subtle: {
      digest(algorithm: string, data: ArrayBufferView): Promise<ArrayBuffer>;
    };
  };
  readonly TextEncoder: new () => { encode(input: string): Uint8Array };
}

const webGlobals = globalThis as unknown as WebGlobals;

/**
 * The strong entity-tag for one serialized representation — quoted, so the
 * value is what an `ETag` header carries verbatim and what an `If-Match`
 * token is compared against without re-parsing.
 *
 * SHA-256 rather than a cheap non-cryptographic hash on purpose: for
 * `If-Match` a collision is a silently lost update, which is the one
 * failure mode this feature exists to prevent.
 */
export async function computeEtag(representation: unknown): Promise<string> {
  const bytes = new webGlobals.TextEncoder().encode(canonicalize(representation));
  const digest = new Uint8Array(await webGlobals.crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (let index = 0; index < digest.length; index++) {
    hex += (digest[index] as number).toString(16).padStart(2, "0");
  }
  return `"${hex}"`;
}

/**
 * A canonical string form of a serialized representation: **object keys
 * sorted**, so the tag depends on the representation's content and not on
 * the key insertion order the DTO projection happened to produce. Plain
 * `JSON.stringify` would make an ETag change when a DTO's field order
 * changed, which is a spurious cache miss and a spurious 412.
 *
 * Otherwise it follows `JSON.stringify`'s conventions — `undefined` object
 * members are dropped, `undefined` array members become `null`, dates
 * render as ISO strings — because the representation being hashed is the
 * one about to be JSON-encoded onto the wire.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return JSON.stringify(value.toString());
    case "object":
      break;
    default:
      // Functions and symbols never survive JSON encoding either.
      return "null";
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const source = value as Record<string, unknown>;
  const members: string[] = [];
  for (const key of Object.keys(source).sort()) {
    const member = source[key];
    if (member === undefined) continue;
    members.push(`${JSON.stringify(key)}:${canonicalize(member)}`);
  }
  return `{${members.join(",")}}`;
}

/**
 * `If-Match` uses the **strong** comparison function (RFC 9110 §8.8.3.2):
 * a weak tag never matches, because the client is about to overwrite the
 * resource and a weak tag only promises semantic equivalence.
 */
export function strongMatch(candidates: readonly string[], etag: string): boolean {
  return candidates.some((candidate) => candidate === WILDCARD || (!isWeak(candidate) && candidate === etag));
}

/**
 * `If-None-Match` uses the **weak** comparison function: the client is
 * asking "is my cached copy still good enough", so a `W/` prefix on either
 * side is ignored.
 */
export function weakMatch(candidates: readonly string[], etag: string): boolean {
  return candidates.some((candidate) => candidate === WILDCARD || opaqueTag(candidate) === opaqueTag(etag));
}

function isWeak(tag: string): boolean {
  return tag.startsWith(WEAK_PREFIX);
}

function opaqueTag(tag: string): string {
  return isWeak(tag) ? tag.slice(WEAK_PREFIX.length) : tag;
}
