import type { DataSource } from "typeorm";
import { QueryValidationException } from "@kavo/core";
import { Owner } from "../owner/owner.entity.js";

const POSTAL_CODE_PATTERN = /^\d{5}$/;

/** Reused by `AddressController`'s `createOne`/`updateOne`/`patchOne` overrides and the custom route alike. */
export function normalizePostalCode(raw: string): string {
  return raw.trim();
}

export function assertValidPostalCode(value: string): void {
  if (!POSTAL_CODE_PATTERN.test(value)) {
    throw QueryValidationException.single({
      field: "postalCode",
      code: "KAVO_QUERY_INVALID_VALUE",
      detail: `postalCode must be exactly 5 digits, got "${value}"`,
    });
  }
}

/**
 * `Owner` owns the join column (`owner.entity.ts`), so clearing it before
 * an address is deleted is a cross-entity write no `RepositoryAdapter<Address>`
 * can perform — `AddressController`'s `deleteOne` override reaches for the
 * raw `DataSource` deliberately, not as a pattern that belongs in
 * `@kavo/typeorm`.
 */
export async function clearOwnerAddress(dataSource: DataSource, addressId: number): Promise<void> {
  const ownerRepository = dataSource.getRepository(Owner);
  const owner = await ownerRepository.findOne({ where: { address: { id: addressId } } });
  if (owner !== null) {
    owner.address = null;
    await ownerRepository.save(owner);
  }
}
