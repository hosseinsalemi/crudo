# ADR-0006 — Registry-driven operation dispatch

**Status:** accepted

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

- One mechanism, several behaviors (the same DRY constraint underlying ADR-0001);
  later features (restore/purge) get routes by adding entries, with zero
  changes to the generator.
- Built-ins pay one table lookup of indirection — negligible.
- The registry's shape is load-bearing API: entries carry DTO slots and
  the `meta` bag (ADR-0007) so both the engine and the framework layer can
  read everything they need from one place.

**Amendment:** `EntityConfig.customOperations` — the config surface for
adding a wholly new operation id, with its own DTOs, dispatched through
the engine — was removed (its only real consumer was the `@Override`
trick documented in `10-nestjs-integration.md` §2, itself superseded by
the fully custom, registry-independent route pattern from issue #26).
The registry mechanism itself is unchanged: `OperationRegistry.register`
still accepts any entry, `disable`/`override` still work by id, and
nothing here special-cases the standard operations. What is gone is the
per-entity config path for reaching `register` with a new id — an action
with no operation identity now reaches for a plain native-decorated
controller method instead, never for engine dispatch.
