import { Controller } from "@nestjs/common";
import { Crud } from "@kavo/nest";
import type { EntityId, IdentifiedWrite, OperationHandler } from "@kavo/core";
import { NotFoundException } from "@kavo/core";
import { Address } from "./address.entity.js";
import { CreateAddressDto, UpdateAddressDto, AddressItemDto, AddressListDto } from "./address.dtos.js";
import { addressRuntime, assertValidPostalCode, clearOwnerAddress, normalizePostalCode } from "./address.runtime.js";

function notFound(id: EntityId): never {
  throw new NotFoundException({ messageParams: { entity: "Address", id: String(id) } });
}

/** `createOne` override: normalizes `postalCode` before persisting. */
const createOne: OperationHandler<Address, Partial<Address>> = {
  async execute(data, context) {
    const postalCode = normalizePostalCode(data.postalCode ?? "");
    assertValidPostalCode(postalCode);
    return addressRuntime().adapter.create({ ...data, postalCode }, context);
  },
};

/** `updateOne` override: PUT sends the whole shape, so `postalCode` is always validated. */
const updateOne: OperationHandler<Address, IdentifiedWrite<Address>> = {
  async execute({ id, data }, context) {
    const patch = { ...data };
    if (patch.postalCode !== undefined) {
      patch.postalCode = normalizePostalCode(patch.postalCode);
      assertValidPostalCode(patch.postalCode);
    }
    return addressRuntime().adapter.update(id, patch, context);
  },
};

/** `patchOne` override: same validation, but only when the field is actually present. */
const patchOne: OperationHandler<Address, IdentifiedWrite<Address>> = {
  async execute({ id, data }, context) {
    const patch = { ...data };
    if (patch.postalCode !== undefined) {
      patch.postalCode = normalizePostalCode(patch.postalCode);
      assertValidPostalCode(patch.postalCode);
    }
    return addressRuntime().adapter.patch(id, patch, context);
  },
};

/**
 * `deleteOne` override: `Owner` owns the join column, so the address's
 * inverse relation can't clear it itself — the owner referencing this row
 * is detached before the address is removed.
 */
const deleteOne: OperationHandler<Address, EntityId> = {
  async execute(id, context) {
    const { adapter, dataSource } = addressRuntime();
    await clearOwnerAddress(dataSource, Number(id));
    await adapter.delete(id, context);
    return null;
  },
};

/** `findOne` override: augments the response with a derived, unpersisted field. */
const findOne: OperationHandler<Address, EntityId> = {
  async execute(id, context) {
    const { adapter } = addressRuntime();
    const address = await adapter.findOneById(id, context.query, context);
    if (address === null) notFound(id);
    return { ...address, formattedAddress: `${address.street}, ${address.city} ${address.postalCode}` };
  },
};

/**
 * Custom operation: `POST /addresses/:id/normalize-postal-code` reuses the
 * same normalization/validation as the `createOne`/`updateOne` overrides,
 * applied to an already-persisted row.
 */
const normalizePostalCodeOperation: OperationHandler<Address, { id: EntityId }> = {
  async execute({ id }, context) {
    const { adapter } = addressRuntime();
    const existing = await adapter.findOneById(id, null, context);
    if (existing === null) notFound(id);
    const postalCode = normalizePostalCode(existing.postalCode);
    assertValidPostalCode(postalCode);
    return adapter.update(id, { postalCode }, context);
  },
};

/**
 * `Address` overrides all five singular standard operations and adds one
 * custom operation, all through `EntityConfig` — registry-driven per
 * ADR-0006, with zero special-casing in the engine or route generator
 * (issue #21). Owners still associate an address by id
 * (`{"address": 1}` on `POST /owners` — ADR-0014).
 */
@Crud(Address, {
  dto: {
    create: CreateAddressDto,
    update: UpdateAddressDto,
    item: AddressItemDto,
    list: AddressListDto,
  },
  operations: {
    createOne: { handler: createOne },
    updateOne: { handler: updateOne },
    patchOne: { handler: patchOne },
    deleteOne: { handler: deleteOne },
    findOne: { handler: findOne },
  },
  customOperations: {
    normalizePostalCode: {
      handler: normalizePostalCodeOperation,
      meta: { routes: { method: "POST", path: ":id/normalize-postal-code" } },
    },
  },
})
@Controller("addresses")
export class AddressController {}
