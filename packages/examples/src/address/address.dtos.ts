/**
 * DTO slots for the Address route. Plain initialized-field classes, same
 * rationale as every other entity's DTOs (see cat.dtos.ts).
 */

/** `create` slot — request body for POST /addresses. */
export class CreateAddressDto {
  street = "";
  city = "";
  postalCode = "";
}

/** `update` slot — request body for PUT /addresses/:id (patch derives from it). */
export class UpdateAddressDto {
  street = "";
  city = "";
  postalCode = "";
}

/** `item` slot — the detail projection. */
export class AddressItemDto {
  id = 0;
  street = "";
  city = "";
  postalCode = "";
  /** Derived by the `findOne` override — never a persisted column. */
  formattedAddress = "";
}

/** `list` slot — a leaner projection for list responses. */
export class AddressListDto {
  id = 0;
  street = "";
  city = "";
}
