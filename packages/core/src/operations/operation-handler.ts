import type { CrudContext } from "../context/crud-context.js";

/**
 * Opaque, module-augmentable metadata bag carried by every operation
 * registry entry. Core's only contract: store it, merge it per Phase 8
 * precedence (global routes → entity → operation), and hand it to the
 * framework layer.
 *
 * Consumers type their keys via declaration merging — `@crudo/nest`
 * augments it with route options:
 *
 * ```ts
 * // in @crudo/nest
 * declare module "@crudo/core" {
 *   interface OperationMetadata {
 *     routes?: {
 *       method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
 *       path?: string;
 *       /** `false` = service-only: callable in code, no route. *\/
 *       enabled?: boolean;
 *       swagger?: Record<string, unknown>;
 *     };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OperationMetadata {}

/**
 * The single execution contract every operation flows through — built-in
 * CRUD, overridden, and custom operations alike (Phase 13: one mechanism,
 * three behaviors). Handlers run inside the Phase 7 pipeline and receive
 * the fully-resolved per-request context.
 */
export interface OperationHandler<Entity = unknown, Input = unknown, Output = unknown> {
  execute(input: Input, context: CrudContext<Entity>): Promise<Output>;
}
