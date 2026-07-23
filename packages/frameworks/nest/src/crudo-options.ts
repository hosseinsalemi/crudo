import type { CrudInfrastructure, CrudoSettings, DeepPartial, PaginationStrategy } from "@crudo/core";

/**
 * `CrudoModule.forRoot` options — the NestJS skin over core's
 * `createCrudo` (Phase 8): `defaults` is the same global-scope settings
 * tree, passed through untouched.
 *
 * `infrastructure` arrives from the application (e.g.
 * `createTypeOrmInfrastructure(dataSource)`), not from an `orm: "typeorm"`
 * string: `@crudo/nest` must not import ORM adapters (the Phase 2
 * boundary — adapters reach Nest via DI, not imports), and an explicit
 * object keeps the door open for any adapter without a registry of names.
 */
export interface CrudoModuleOptions {
  readonly infrastructure?: CrudInfrastructure;
  readonly defaults?: DeepPartial<CrudoSettings>;
  readonly paginationStrategies?: readonly PaginationStrategy[];
}
