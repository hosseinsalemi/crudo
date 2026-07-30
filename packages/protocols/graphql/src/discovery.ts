import type { ClassRef, EntityId } from "@kavo/core";
import type { GraphQLSchema } from "graphql";
import type { BoundCrudService, CrudGraphQLOptions } from "./schema.js";
import { mergeCrudGraphQLSchemas } from "./schema.js";
import { getCrudGraphQLTypes } from "./registry.js";

/** The minimum a host framework needs to hand this package about one `@Crud` entity. */
export interface CrudEntityRef {
  readonly entity: ClassRef;
}

/**
 * The host-agnostic half of "discover every entity that registered
 * GraphQL types and put them all on one schema." Two things stay
 * deliberately outside this package, supplied by the caller instead:
 *
 * - **How to enumerate `@Crud` entities** — `@kavo/nest`'s `getCrudEntities()`,
 *   a plain array an Express/Fastify/Next.js app builds by hand, or any
 *   other host's own registry.
 * - **How to resolve a bound service for one entity** — `@kavo/nest`'s
 *   `ModuleRef` + `getCrudServiceToken`, a plain `Map`, or whatever DI
 *   container that host uses.
 *
 * This function only ever touches `@kavo/core` shapes and this package's
 * own type registry — never a host framework — so the same call works
 * from `@kavo/nest`'s `BaseCrudGraphQLController` today and from a future
 * `@kavo/express`/`@kavo/fastify`/`@kavo/nextjs` binding without either
 * package importing the other (ADR-0016).
 */
export function resolveCrudGraphQLSchema(
  entities: readonly CrudEntityRef[],
  resolveService: (entity: ClassRef) => BoundCrudService<object, EntityId, unknown, unknown, unknown, unknown, unknown>,
): GraphQLSchema {
  const bindings: CrudGraphQLOptions<object, EntityId, unknown, unknown, unknown, unknown, unknown>[] = [];

  for (const { entity } of entities) {
    const types = getCrudGraphQLTypes(entity);
    if (types === undefined) {
      continue;
    }
    bindings.push({ name: entity.name, service: resolveService(entity), ...types });
  }

  return mergeCrudGraphQLSchemas(bindings);
}
