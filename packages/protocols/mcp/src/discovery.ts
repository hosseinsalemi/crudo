import type { ClassRef, EntityId } from "@kavo/core";
import type { BoundKavoService, KavoMcpToolBinding } from "./tools.js";
import { crudTools } from "./tools.js";

/** The minimum a host framework needs to hand this package about one `@Kavo` entity. */
export interface KavoEntityRef {
  readonly entity: ClassRef;
}

/**
 * The host-agnostic half of "collect every entity's standard toolset into
 * one process-wide MCP toolset." One thing stays deliberately outside this
 * package, supplied by the caller instead — the same split
 * `@kavo/graphql`'s `resolveKavoGraphQLSchema` uses for its own "how to
 * resolve a service" half:
 *
 * - **How to resolve a bound service for one entity** — `@kavo/nest`'s
 *   `ModuleRef` + `getKavoServiceToken`, a plain `Map`, or whatever DI
 *   container that host uses.
 *
 * Every entity in `entities` gets the full standard toolset unconditionally
 * (`crudTools`, no per-entity opt-in) — the list of entities to expose is
 * controlled entirely by what the caller passes in (e.g. `@kavo/nest`'s
 * `getKavoEntities()`, every `@Kavo`-decorated class), not by a second,
 * MCP-specific registry.
 *
 * This function only ever touches `@kavo/core` shapes — never a host
 * framework — so the same call works from a Nest MCP controller today and
 * from a future `@kavo/express`/`@kavo/fastify`/`@kavo/nextjs` binding
 * without either package importing the other (ADR-0016's `protocols/*`
 * shape).
 *
 * Unlike `mergeKavoGraphQLSchemas` (which must fail fast on an empty
 * `Query` type — GraphQL has no such thing as a schema with zero fields),
 * an empty tool list is a perfectly valid MCP `ListToolsResult`, so an
 * empty `entities` list is not treated as an error here.
 */
export function resolveKavoMcpTools(
  entities: readonly KavoEntityRef[],
  resolveService: (entity: ClassRef) => BoundKavoService<object, EntityId, unknown, unknown, unknown>,
): readonly KavoMcpToolBinding[] {
  const bindings: KavoMcpToolBinding[] = [];

  for (const { entity } of entities) {
    bindings.push(...crudTools({ name: entity.name, service: resolveService(entity) }));
  }

  return bindings;
}
