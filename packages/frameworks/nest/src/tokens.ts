import type { ClassRef, DefaultKavoService } from "@kavo/core";

/** DI token of the Kavo root instance created by `KavoModule.forRoot`. */
export const KAVO_INSTANCE = Symbol("KAVO_INSTANCE");

/** DI token of the resolved `KavoModuleOptions`. */
export const KAVO_MODULE_OPTIONS = Symbol("KAVO_MODULE_OPTIONS");

/** Reflect metadata key the `@Kavo` decorator writes on controllers. */
export const KAVO_CONTROLLER_METADATA = "kavo:controller";

/** Reflect metadata key the `@Override` method decorator writes. */
export const KAVO_OVERRIDE_METADATA = "kavo:override";

/** Property the generated route methods read the injected service from. */
export const KAVO_SERVICE_PROPERTY = "__kavoService";

const serviceTokens = new Map<ClassRef, string>();

/**
 * The injection token of the `KavoService` bound to one entity. Stable per
 * entity class, usable in consumer constructors:
 * `@Inject(getKavoServiceToken(UserEntity))`.
 */
export function getKavoServiceToken(entity: ClassRef): string {
  let token = serviceTokens.get(entity);
  if (token === undefined) {
    token = `KAVO_SERVICE_${entity.name}`;
    serviceTokens.set(entity, token);
  }
  return token;
}

/**
 * Reads the `KavoService` `KavoModule`'s discovery binder already bound onto
 * a `@Kavo`-decorated controller instance — the typed way for the
 * controller's own methods (an `@Override`, or a fully custom native route)
 * to reach it, with no separate constructor injection needed.
 */
export function boundKavoService<Entity extends object>(controller: object): DefaultKavoService<Entity> {
  return (controller as Record<string, unknown>)[KAVO_SERVICE_PROPERTY] as DefaultKavoService<Entity>;
}
