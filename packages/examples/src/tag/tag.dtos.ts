/**
 * DTO slots for the Tag route. See `cat.dtos.ts` for the rationale behind
 * plain initialized-field classes.
 */

/** `create` slot — request body for POST /tags. */
export class CreateTagDto {
  name = "";
}

/** `update` slot — request body for PUT /tags/:id (patch derives from it). */
export class UpdateTagDto {
  name = "";
}

/** `item` slot — the detail projection. */
export class TagItemDto {
  id = 0;
  name = "";
}

/** `list` slot — same shape as `item`; a tag has nothing left to trim. */
export class TagListDto {
  id = 0;
  name = "";
}
