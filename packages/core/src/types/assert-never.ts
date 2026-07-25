/**
 * The runtime half of a compile-time guarantee, and the one runtime member
 * of `types/` — everything else here is type-level.
 *
 * Placing it in a `default:` branch makes a switch over a closed union
 * *prove* it is total: if a member is ever added to the union, the
 * remaining type at `default:` stops being `never` and the build fails at
 * every switch that forgot it. The throw only fires when something reached
 * the branch anyway — a value forged past the type system, typically a
 * hand-built AST from a programmatic caller — and failing loudly there
 * beats the silent alternative, which in a filtering framework means
 * quietly dropping a predicate the caller asked for.
 *
 * Use it only where the set is genuinely closed. Operation ids are *not*
 * closed (custom operations are the ADR-0006 extension seam), so their
 * `default:` branches are load-bearing and must stay.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${String(value)}`);
}
