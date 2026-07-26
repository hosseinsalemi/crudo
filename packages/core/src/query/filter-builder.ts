import type { Filter } from "./filter.js";

/**
 * Translates a validated filter AST into an ORM-native query, implemented
 * by adapter packages (`@kavo/typeorm`'s `FilterTranslator` targets
 * TypeORM's `QueryBuilder`).
 *
 * The target query object is bound by the implementer at construction
 * rather than passed per call, because translation is stateful: parameter
 * names and join aliases must stay unique across every condition applied
 * to the same query. The builder trusts its input — validation happened at
 * parse time.
 */
export interface FilterBuilder<Entity = unknown> {
  apply(filter: Filter<Entity>): void;
}
