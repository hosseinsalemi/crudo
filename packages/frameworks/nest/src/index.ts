/**
 * @crudo/nest — NestJS binding for Crudo (Phases 11–12).
 *
 * `@Crud(Entity)` generates routes from the entity's operation registry;
 * `CrudoModule.forRoot` hosts the Crudo root instance and the RFC 9457
 * exception filter; `forFeature` binds services and controllers. This
 * package augments core's `OperationMetadata` with its `routes` key
 * (ADR-0007). `@nestjs/*` are peerDependencies; `@nestjs/swagger` is
 * optional.
 */
export {
  Crud,
  type CrudControllerMetadata,
} from "./crud.decorator.js";
export {
  CrudoModule,
  type CrudoModuleAsyncOptions,
} from "./crudo.module.js";
export type { CrudoModuleOptions } from "./crudo-options.js";
export { CrudoExceptionFilter } from "./crudo-exception.filter.js";
export { flattenQuery } from "./flatten-query.js";
export {
  CRUDO_INSTANCE,
  CRUDO_MODULE_OPTIONS,
  getCrudServiceToken,
} from "./tokens.js";
export type {
  CrudHttpMethod,
  CrudRouteOptions,
} from "./operation-metadata.js";
