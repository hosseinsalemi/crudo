# ADR-0009 — RFC 9457 problem details as the wire error shape

**Status:** accepted (Phase 1; catalog and hierarchy in Phase 6)

## Context

Every error crossing the wire needs one shape. Options: an ad-hoc
`{ statusCode, message }` (NestJS default), or the standardized problem-
details document.

## Decision

The default serialized error is an RFC 9457 problem-details document
(`ProblemDetailsDto`) with Crudo extensions: a stable `code`
(`CRUDO_*`, catalog in Phase 6 — codes are API surface), `errors[]` for
field-level query issues, `items[]` for per-index bulk failures. Crudo
exceptions never extend Nest's; the `@crudo/nest` exception filter is the
boundary that maps them.

## Consequences

- Standard, tooling-friendly errors; localizable via `messageKey` +
  `messageParams` with English defaults.
- Consumers wanting a different shape swap the serializer — the exception
  hierarchy never changes.
- `exposeInternals` (off by default) governs whether driver detail leaks
  into `detail`/`cause` output.
