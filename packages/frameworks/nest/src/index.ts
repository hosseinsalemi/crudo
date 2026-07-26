/**
 * @kavo/nest — NestJS binding for Kavo (Phases 11–12).
 *
 * `@Crud(Entity)` generates routes from the entity's operation registry;
 * `KavoModule.forRoot` hosts the Kavo root instance and the RFC 9457
 * exception filter; `forFeature` binds services and controllers. This
 * package augments core's `OperationMetadata` with its `routes` key
 * (ADR-0007). `@nestjs/*` are peerDependencies; `@nestjs/swagger` is
 * optional.
 */
export { Crud, type CrudControllerMetadata } from "./crud.decorator.js";
export { Override, type OverrideMetadata } from "./override.decorator.js";
export { KavoModule, type KavoModuleAsyncOptions } from "./kavo.module.js";
export type { KavoModuleOptions } from "./kavo-options.js";
export { KavoExceptionFilter } from "./kavo-exception.filter.js";
export { flattenQuery } from "./flatten-query.js";
export { enumProp, oneOfArray, type SchemaHint } from "./schema-hints.js";
export { KAVO_INSTANCE, KAVO_MODULE_OPTIONS, getCrudServiceToken } from "./tokens.js";
export type { CrudHttpMethod, CrudRouteOptions } from "./operation-metadata.js";
