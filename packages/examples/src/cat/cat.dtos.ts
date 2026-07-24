import { enumProp } from "@crudo/nest";
import { PetSizeEnum } from "../pet/pet.entity.js";

/**
 * DTO slots for the Cat route (Phase 4). Fields are initialized so the
 * classes carry their shape at runtime — that is what lets the default
 * serializer project responses (and Swagger document them) with no
 * decorator machinery. The `species` discriminator is deliberately absent
 * from every slot: it is never client-writable and never echoed.
 */

/** `create` slot — request body for POST /cats. */
export class CreateCatDto {
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  indoor = false;
  livesLeft = 9;
  // Association by id (Phase 15, ADR-0014): send the owner's id, or an
  // `{ id }` reference. Deep nested writes are deliberately out of scope.
  owner: number | null = null;
}

/** `update` slot — request body for PUT /cats/:id (patch derives from it). */
export class UpdateCatDto {
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  indoor = false;
  livesLeft = 0;
  owner: number | null = null;
}

/** `item` slot — the detail projection. */
export class CatItemDto {
  id = 0;
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  indoor = false;
  livesLeft = 0;
  createdAt: Date = new Date(0);
}

/** `list` slot — a leaner projection for list responses. */
export class CatListDto {
  id = 0;
  name = "";
  indoor = false;
}
