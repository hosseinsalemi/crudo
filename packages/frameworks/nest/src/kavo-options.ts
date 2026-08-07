import type { KavoInfrastructure, KavoSettings, DeepPartial, PaginationStrategy } from "@kavo/core";
import type { KavoPrincipalOption } from "./principal.js";

/**
 * `KavoModule.forRoot` options — the NestJS skin over core's
 * `createKavo`: `defaults` is the same global-scope settings
 * tree, passed through untouched.
 *
 * `infrastructure` arrives from the application (e.g.
 * `createInfrastructure(dataSource)`), not from an `orm: "typeorm"`
 * string: `@kavo/nest` must not import ORM adapters (adapters reach Nest
 * via DI, not imports), and an explicit
 * object keeps the door open for any adapter without a registry of names.
 */
export interface KavoModuleOptions {
  readonly infrastructure?: KavoInfrastructure;
  readonly defaults?: DeepPartial<KavoSettings>;
  readonly paginationStrategies?: readonly PaginationStrategy[];
  /**
   * Where a generated route finds the authenticated caller to put on
   * `KavoContext.principal` — `true` for `request.user`, or a function for
   * anything else. Module scope rather than an assumption, because a Nest
   * app's guard may leave the caller anywhere; and an option rather than a
   * default, because populating it silently would change what every
   * existing `principal`-reading computed field or handler returns on
   * upgrade. Unset means `principal` stays `null`, as it always has.
   *
   * It is `@kavo/nest`'s own concern and never reaches `createKavo`: core
   * takes the principal per call (`KavoCallOptions.principal`) and has no
   * idea what an HTTP request is (ADR-0005).
   */
  readonly principal?: KavoPrincipalOption;
}
