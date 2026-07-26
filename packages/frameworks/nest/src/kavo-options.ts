import type { CrudInfrastructure, KavoSettings, DeepPartial, PaginationStrategy } from "@kavo/core";

/**
 * `KavoModule.forRoot` options — the NestJS skin over core's
 * `createKavo` (Phase 8): `defaults` is the same global-scope settings
 * tree, passed through untouched.
 *
 * `infrastructure` arrives from the application (e.g.
 * `createTypeOrmInfrastructure(dataSource)`), not from an `orm: "typeorm"`
 * string: `@kavo/nest` must not import ORM adapters (the Phase 2
 * boundary — adapters reach Nest via DI, not imports), and an explicit
 * object keeps the door open for any adapter without a registry of names.
 */
export interface KavoModuleOptions {
  readonly infrastructure?: CrudInfrastructure;
  readonly defaults?: DeepPartial<KavoSettings>;
  readonly paginationStrategies?: readonly PaginationStrategy[];
}
