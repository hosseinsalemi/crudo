import type { Filter } from "./filter.js";
import type { CrudContext } from "../context/crud-context.js";

/**
 * Translates a validated filter AST into an ORM-native query, implemented
 * by adapter packages (`@crudo/typeorm` targets TypeORM's `QueryBuilder`).
 *
 * `Target` is the adapter's mutable query object; `apply` returns it to
 * allow chaining whether the target is mutated in place or replaced. The
 * builder trusts its input — validation happened at parse time.
 */
export interface FilterBuilder<Entity = unknown, Target = unknown> {
  apply(filter: Filter<Entity>, target: Target, context: CrudContext<Entity>): Target;
}
