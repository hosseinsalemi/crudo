import { Controller, Inject } from "@nestjs/common";
import { Crud, Override, flattenQuery, getCrudServiceToken } from "@kavo/nest";
import type { DefaultCrudService, EntityId } from "@kavo/core";
import { WireQuery } from "@kavo/core";
import type { DataSource } from "typeorm";
import { Address } from "./address.entity.js";
import { CreateAddressDto, UpdateAddressDto, AddressItemDto, AddressListDto } from "./address.dtos.js";
import { DATA_SOURCE } from "../database.module.js";
import { assertValidPostalCode, clearOwnerAddress, normalizePostalCode } from "./address.runtime.js";

/**
 * `Address` overrides all five singular standard operations and adds one
 * custom operation, each backed by an `@Override`'d controller method
 * (issue #23) rather than a config-level `operations.<id>.handler` — every
 * method injects the entity's own `DefaultCrudService` (`base`) to
 * delegate to default behavior, and the raw `DataSource` for the one write
 * that reaches across entities. `@Crud` still generates every route's
 * method, path, status, params, and Swagger metadata from the registry
 * (ADR-0006, ADR-0012); only the function backing each route is this
 * class's own method. Owners still associate an address by id
 * (`{"address": 1}` on `POST /owners` — ADR-0014).
 */
@Crud(Address, {
  dto: {
    create: CreateAddressDto,
    update: UpdateAddressDto,
    item: AddressItemDto,
    list: AddressListDto,
  },
  customOperations: {
    normalizePostalCode: {
      // Required by `CustomOperationConfig`, but never runs — `@Override`
      // below supplies the real implementation.
      handler: {
        async execute() {
          throw new Error("normalizePostalCode is implemented via @Override — this registry handler must not run");
        },
      },
      meta: { routes: { method: "POST", path: ":id/normalize-postal-code" } },
    },
  },
})
@Controller("addresses")
export class AddressController {
  constructor(
    @Inject(getCrudServiceToken(Address)) private readonly base: DefaultCrudService<Address>,
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
  ) {}

  /** Normalizes `postalCode` before persisting. */
  @Override()
  async createOne(dto: Partial<Address>): Promise<unknown> {
    const postalCode = normalizePostalCode(dto.postalCode ?? "");
    assertValidPostalCode(postalCode);
    return this.base.createOne({ ...dto, postalCode } as never);
  }

  /** PUT sends the whole shape, so `postalCode` is always validated. */
  @Override()
  async updateOne(id: EntityId, dto: Partial<Address>): Promise<unknown> {
    const patch = { ...dto };
    if (patch.postalCode !== undefined) {
      patch.postalCode = normalizePostalCode(patch.postalCode);
      assertValidPostalCode(patch.postalCode);
    }
    return this.base.updateOne(id as never, patch as never);
  }

  /** Same validation as `updateOne`, but only when the field is actually present. */
  @Override()
  async patchOne(id: EntityId, dto: Partial<Address>): Promise<unknown> {
    const patch = { ...dto };
    if (patch.postalCode !== undefined) {
      patch.postalCode = normalizePostalCode(patch.postalCode);
      assertValidPostalCode(patch.postalCode);
    }
    return this.base.patchOne(id as never, patch as never);
  }

  /**
   * `Owner` owns the join column (`owner.entity.ts`), so the owner
   * referencing this row is detached before the address is removed.
   */
  @Override()
  async deleteOne(id: EntityId): Promise<void> {
    await clearOwnerAddress(this.dataSource, Number(id));
    await this.base.deleteOne(id as never);
  }

  /**
   * Augments the response with a derived, unpersisted field. `query`
   * arrives as Nest's raw `@Query()` object — the generated route always
   * wraps it in `WireQuery` (via `flattenQuery`) before it reaches
   * `DefaultCrudService`, so a read override must do the same, or wire-
   * format params like `?fields=` / `?include=` reach the engine
   * unparsed and 400.
   */
  @Override()
  async findOne(id: EntityId, query: unknown): Promise<unknown> {
    const wired = new WireQuery(flattenQuery((query ?? {}) as Readonly<Record<string, unknown>>));
    const address = await this.base.findOne(id as never, wired as never);
    return { ...address, formattedAddress: `${address.street}, ${address.city} ${address.postalCode}` };
  }

  /**
   * `POST /addresses/:id/normalize-postal-code` — reuses the same
   * normalization/validation as `createOne`/`updateOne`/`patchOne`, applied
   * to an already-persisted row. The method name differs from the
   * operation id (it collides with the imported `normalizePostalCode`
   * helper), so `@Override` is given the id explicitly.
   */
  @Override("normalizePostalCode")
  async normalizePostalCodeRoute(id: EntityId): Promise<unknown> {
    const existing = await this.base.findOne(id as never);
    const postalCode = normalizePostalCode(existing.postalCode);
    assertValidPostalCode(postalCode);
    return this.base.updateOne(id as never, { postalCode } as never);
  }
}
