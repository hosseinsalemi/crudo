# ADR-0006 — Registry-driven operation dispatch

**Status:** accepted (Phase 1; mechanics Phase 7, control surface Phase 14)

## Context

Three developer needs — disable an operation, override its behavior, add a
new one — plus route generation could each grow their own mechanism
(flags, subclass hooks, decorator magic, hardcoded verb lists).

## Decision

The engine dispatches **every** operation through
`OperationRegistry<TEntity>`. Built-in CRUD handlers are ordinary default
entries — nothing about them is special-cased. Disable = deactivate an
entry; override = swap its handler; custom = add an entry. `@kavo/nest`
generates routes by reading the registry, never from a verb list.

## Consequences

- One mechanism, several behaviors (the DRY constraint from Phase 1);
  later features (restore/purge, bulk, custom ops) get routes by adding
  entries, with zero changes to the generator.
- Built-ins pay one table lookup of indirection — negligible.
- The registry's shape is load-bearing API: entries carry DTO slots and
  the `meta` bag (ADR-0007) so both the engine and the framework layer can
  read everything they need from one place.
