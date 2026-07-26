import { oneOfArray } from "@crudo/nest";
import { CatItemDto } from "../cat/cat.dtos.js";
import { DogItemDto } from "../dog/dog.dtos.js";
import { AddressItemDto } from "../address/address.dtos.js";

/**
 * DTO slots for the Owner route (Phase 4). See `cat.dtos.ts` for the
 * rationale behind plain initialized-field classes.
 */

/** `create` slot — request body for POST /owners. */
export class CreateOwnerDto {
  name = "";
  email = "";
  startedAt: Date | null = null;
  // Association by id (ADR-0014): send the address's id, or an `{ id }`
  // reference. Deep nested writes are deliberately out of scope.
  address: number | null = null;
}

/** `update` slot — request body for PUT /owners/:id (patch derives from it). */
export class UpdateOwnerDto {
  name = "";
  email = "";
  startedAt: Date | null = null;
  address: number | null = null;
}

/** `item` slot — the detail projection. */
export class OwnerItemDto {
  id = 0;
  name = "";
  email = "";
  startedAt: Date | null = null;
  createdAt: Date = new Date(0);
  // Documented as a `oneOf` array of pet subtypes. The declaration is the
  // shape, not the load: the field appears only when asked for with
  // `?include=pets`, so a plain GET does not pay for the relation.
  pets = oneOfArray<CatItemDto | DogItemDto>([CatItemDto, DogItemDto]);
  // Documented the same way: shape only, present in the response solely
  // when `?include=address` asks for it.
  address: AddressItemDto | null = null;
}

/** `list` slot — a leaner projection for list responses. */
export class OwnerListDto {
  id = 0;
  name = "";
  email = "";
}
