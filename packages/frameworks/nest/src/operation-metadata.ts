/**
 * `@crudo/nest`'s module augmentation of core's opaque `OperationMetadata`
 * (ADR-0007): route concerns attach to operation registry entries without
 * core knowing HTTP exists. Route generation reads `meta.routes`; core
 * only stores and merges the bag.
 */

/** HTTP verbs the route generator can emit. */
export type CrudHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CrudRouteOptions {
  readonly method?: CrudHttpMethod;
  /** Route path relative to the controller (`":id/activate"`). */
  readonly path?: string;
  /**
   * `false` = service-only: the operation stays callable in code, but no
   * route is generated (Phase 14's `http: false`).
   */
  readonly enabled?: boolean;
  /** Success status override (defaults: 201 create, 204 delete, 200 else). */
  readonly successStatus?: number;
}

declare module "@crudo/core" {
  interface OperationMetadata {
    routes?: CrudRouteOptions;
  }
}
