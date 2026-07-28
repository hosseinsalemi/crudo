/**
 * @kavo/nest — NestJS binding for Kavo (Phases 11–12).
 *
 * `@Crud(Entity)` generates routes from the entity's operation registry;
 * `KavoModule.forRoot`/`forRootAsync` host the Kavo root instance, the RFC
 * 9457 exception filter, and a discovery binder that finds every
 * `@Crud`-decorated controller already registered in the app (however it
 * got there — an ordinary Nest `controllers:` array is enough) and binds
 * its service, with no explicit list required. `forFeature` remains for the
 * one case that still needs a real DI provider: a controller that
 * constructor-injects `getCrudServiceToken(Entity)` itself. This package
 * augments core's `OperationMetadata` with its `routes` key (ADR-0007).
 * `@nestjs/*` are peerDependencies; `@nestjs/swagger` is optional.
 */
export { Crud, type CrudControllerMetadata } from "./crud.decorator.js";
export { Override, type OverrideMetadata } from "./override.decorator.js";
export { KavoModule, type KavoModuleAsyncOptions } from "./kavo.module.js";
export type { KavoModuleOptions } from "./kavo-options.js";
export { KavoExceptionFilter } from "./kavo-exception.filter.js";
export { flattenQuery } from "./flatten-query.js";
export { enumProp, oneOfArray, type SchemaHint } from "./schema-hints.js";
export { KAVO_INSTANCE, KAVO_MODULE_OPTIONS, getCrudServiceToken, boundCrudService } from "./tokens.js";
export type { CrudHttpMethod, CrudRouteOptions } from "./operation-metadata.js";
