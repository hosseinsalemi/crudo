import type { EntityId } from "../types/entity-id.js";
import type { EntityReader } from "./entity-reader.js";
import type { EntityWriter } from "./entity-writer.js";

/**
 * The full persistence contract an ORM adapter implements — reads plus
 * writes. Split into {@link EntityReader} / {@link EntityWriter} so
 * read-only consumers (and read-only decorators) can depend on half the
 * surface. Adapters are named for what they adapt:
 * `TypeOrmRepositoryAdapter` (`@kavo/typeorm`).
 */
export interface RepositoryAdapter<Entity = unknown, Id extends EntityId = EntityId>
  extends EntityReader<Entity, Id>, EntityWriter<Entity, Id> {}
