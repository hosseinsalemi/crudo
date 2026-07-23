import { enumProp } from "@crudo/nest";
import { PetSizeEnum } from "./pet.entity.js";

/**
 * DTO slots for the Dog route (Phase 4). See `cat.dtos.ts` for the rationale
 * behind plain initialized-field classes and the absent `species` slot.
 */

/** `create` slot — request body for POST /dogs. */
export class CreateDogDto {
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  breed = "";
  goodBoy = true;
}

/** `update` slot — request body for PUT /dogs/:id (patch derives from it). */
export class UpdateDogDto {
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  breed = "";
  goodBoy = false;
}

/** `item` slot — the detail projection. */
export class DogItemDto {
  id = 0;
  name = "";
  age = 0;
  size = enumProp(Object.values(PetSizeEnum), { example: PetSizeEnum.Medium });
  breed = "";
  goodBoy = false;
  createdAt: Date = new Date(0);
}

/** `list` slot — a leaner projection for list responses. */
export class DogListDto {
  id = 0;
  name = "";
  breed = "";
}
