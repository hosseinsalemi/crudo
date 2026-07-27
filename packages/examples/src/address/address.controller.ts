import { Controller, Get, Inject, Param } from "@nestjs/common";
import { Crud, Override, getCrudServiceToken } from "@kavo/nest";
import type { DefaultCrudService, EntityId, WireQuery } from "@kavo/core";
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
 *
 * `validatePostalCode` below demonstrates the other custom-route pattern
 * (issue #26): a plain native Nest method with no `customOperations` entry
 * at all, for an action that has no operation identity and wants none of
 * the registry-generated route/Swagger/param machinery `normalizePostalCode`
 * relies on `@Override` for.
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
      // `@Override` (below) attaches to an *existing* registry entry — it
      // doesn't create one — so this entry exists purely to give the
      // registry an operation id and `meta.routes` to generate the route's
      // method/path/status/Swagger metadata from. This handler itself
      // never runs; `@Override` replaces it with `normalizePostalCodeRoute`.
      // A custom route with no need for that generated machinery needs no
      // entry at all — see `validatePostalCode` below.
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
   * arrives already wired — `@Crud` applies the same `WireQuery`-producing
   * pipe to an `@Override`'d read method's `query` param as it does to a
   * generated route's.
   */
  @Override()
  async findOne(id: EntityId, query: WireQuery): Promise<unknown> {
    const address = await this.base.findOne(id as never, query as never);
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

  /**
   * `GET /addresses/:id/validate-postal-code` — a fully custom,
   * registry-independent route (issue #26): a plain native `@Get` with its
   * own `@Param`, no `customOperations` entry. `@Crud` never inspects this
   * method — route generation only checks method names against registry
   * operation ids (manual-method-wins) or `@Override` metadata, and
   * `validatePostalCode` matches neither. It needs nothing from Kavo beyond
   * the constructor-injected `base` service, the same `getCrudServiceToken`
   * DI every `@Override`'d method above already uses. Unlike
   * `normalizePostalCode`, it's read-only and wants none of `@Override`'s
   * generated route/Swagger/param wiring, so it has none.
   */
  @Get(":id/validate-postal-code")
  async validatePostalCode(@Param("id") id: EntityId): Promise<{ valid: boolean }> {
    const existing = await this.base.findOne(id as never);
    try {
      assertValidPostalCode(existing.postalCode);
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }
}
