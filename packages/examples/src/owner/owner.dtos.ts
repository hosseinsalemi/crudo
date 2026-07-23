import { oneOfArray } from "@crudo/nest";
import { CatItemDto } from "../cat/cat.dtos.js";
import { DogItemDto } from "../dog/dog.dtos.js";

/**
 * DTO slots for the Owner route (Phase 4). See `cat.dtos.ts` for the
 * rationale behind plain initialized-field classes.
 */

/** `create` slot — request body for POST /owners. */
export class CreateOwnerDto {
  name = "";
  email = "";
  startedAt: Date | null = null;
}

/** `update` slot — request body for PUT /owners/:id (patch derives from it). */
export class UpdateOwnerDto {
  name = "";
  email = "";
  startedAt: Date | null = null;
}

/** `item` slot — the detail projection. */
export class OwnerItemDto {
  id = 0;
  name = "";
  email = "";
  startedAt: Date | null = null;
  createdAt: Date = new Date(0);
  // Documented as a `oneOf` array of pet subtypes. Relation includes are a
  // deferred feature, so the field is absent from responses until a later
  // phase populates it — but the schema advertises its shape today.
  pets = oneOfArray<CatItemDto | DogItemDto>([CatItemDto, DogItemDto]);
}

/** `list` slot — a leaner projection for list responses. */
export class OwnerListDto {
  id = 0;
  name = "";
  email = "";
}
