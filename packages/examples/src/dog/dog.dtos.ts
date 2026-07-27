import { enumProp } from "@kavo/nest";
import { PetSizeEnum } from "../pet/pet.entity.js";

/**
 * `DogController` no longer registers a `dto` block — every slot resolves
 * entity-derived (see `dog.controller.ts`). `DogItemDto` survives here only
 * because `owner.dtos.ts` needs a concrete class for the `Dog` half of its
 * polymorphic `pets` union; it is unrelated to the `/dogs` route's own
 * request/response shape.
 */

/** Used by `owner.dtos.ts`'s `pets` oneOf — not by the `/dogs` route itself. */
export class DogItemDto {
  id = 0;
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  breed = "";
  goodBoy = false;
  createdAt: Date = new Date(0);
}
