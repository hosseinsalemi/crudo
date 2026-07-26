import type { ClassRef } from "@kavo/core";

/** DI token of the Kavo root instance created by `KavoModule.forRoot`. */
export const KAVO_INSTANCE = Symbol("KAVO_INSTANCE");

/** DI token of the resolved `KavoModuleOptions`. */
export const KAVO_MODULE_OPTIONS = Symbol("KAVO_MODULE_OPTIONS");

/** Reflect metadata key the `@Crud` decorator writes on controllers. */
export const CRUD_CONTROLLER_METADATA = "kavo:controller";

/** Reflect metadata key the `@Override` method decorator writes. */
export const CRUD_OVERRIDE_METADATA = "kavo:override";

/** Property the generated route methods read the injected service from. */
export const CRUD_SERVICE_PROPERTY = "__kavoService";

const serviceTokens = new Map<ClassRef, string>();

/**
 * The injection token of the `CrudService` bound to one entity. Stable per
 * entity class, usable in consumer constructors:
 * `@Inject(getCrudServiceToken(UserEntity))`.
 */
export function getCrudServiceToken(entity: ClassRef): string {
  let token = serviceTokens.get(entity);
  if (token === undefined) {
    token = `KAVO_SERVICE_${entity.name}`;
    serviceTokens.set(entity, token);
  }
  return token;
}
