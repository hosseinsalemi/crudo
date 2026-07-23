import type { ClassRef } from "@crudo/core";

/** DI token of the Crudo root instance created by `CrudoModule.forRoot`. */
export const CRUDO_INSTANCE = Symbol("CRUDO_INSTANCE");

/** DI token of the resolved `CrudoModuleOptions`. */
export const CRUDO_MODULE_OPTIONS = Symbol("CRUDO_MODULE_OPTIONS");

/** Reflect metadata key the `@Crud` decorator writes on controllers. */
export const CRUD_CONTROLLER_METADATA = "crudo:controller";

/** Property the generated route methods read the injected service from. */
export const CRUD_SERVICE_PROPERTY = "__crudoService";

const serviceTokens = new Map<ClassRef, string>();

/**
 * The injection token of the `CrudService` bound to one entity. Stable per
 * entity class, usable in consumer constructors:
 * `@Inject(getCrudServiceToken(UserEntity))`.
 */
export function getCrudServiceToken(entity: ClassRef): string {
  let token = serviceTokens.get(entity);
  if (token === undefined) {
    token = `CRUDO_SERVICE_${entity.name}`;
    serviceTokens.set(entity, token);
  }
  return token;
}
