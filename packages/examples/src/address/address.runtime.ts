import type { DataSource } from "typeorm";
import type { RepositoryAdapter } from "@kavo/core";
import { QueryValidationException } from "@kavo/core";
import type { Address } from "./address.entity.js";
import { Owner } from "../owner/owner.entity.js";

const POSTAL_CODE_PATTERN = /^\d{5}$/;

/** Reused by the `createOne`/`updateOne` overrides and the custom route alike. */
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

export interface AddressRuntime {
  readonly adapter: RepositoryAdapter<Address>;
  readonly dataSource: DataSource;
}

let runtime: AddressRuntime | null = null;

/**
 * `@Crud`'s operation overrides are captured at class-decoration time
 * (ADR-0012) — module import, before `KavoModule.forRootAsync`'s factory
 * ever builds the `DataSource` — so `address.controller.ts`'s handler
 * literals cannot close over a ready adapter when they are written. Each
 * handler instead calls `addressRuntime()` at request time, long after
 * `app.module.ts` has called this once the real infrastructure exists.
 */
export function bindAddressRuntime(next: AddressRuntime): void {
  runtime = next;
}

export function addressRuntime(): AddressRuntime {
  if (runtime === null) {
    throw new Error("Address runtime not bound — call bindAddressRuntime() during app bootstrap");
  }
  return runtime;
}

/**
 * `Owner` owns the join column (`owner.entity.ts`), so clearing it before
 * an address is deleted is a cross-entity write `RepositoryAdapter<Address>`
 * has no way to perform — the `deleteOne` override reaches for the raw
 * `DataSource` deliberately, not as a pattern that belongs in `@kavo/typeorm`.
 */
export async function clearOwnerAddress(dataSource: DataSource, addressId: number): Promise<void> {
  const ownerRepository = dataSource.getRepository(Owner);
  const owner = await ownerRepository.findOne({ where: { address: { id: addressId } } });
  if (owner !== null) {
    owner.address = null;
    await ownerRepository.save(owner);
  }
}
