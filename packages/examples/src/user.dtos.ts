/**
 * DTO classes for the checkpoint app (Phase 4 slots). Fields are
 * initialized so the classes carry their shape at runtime — that is what
 * lets the default serializer project responses from them (and Swagger
 * document them) without any decorator machinery.
 */

/** `create` slot — request body for POST /users. */
export class CreateUserDto {
  email = "";
  name = "";
  age = 0;
}

/** `update` slot — request body for PUT /users/:id (patch derives from it). */
export class UpdateUserDto {
  email = "";
  name = "";
  age = 0;
  status = "";
}

/** `item` slot — the detail projection (hides nothing here but is explicit). */
export class UserItemDto {
  id = 0;
  email = "";
  name = "";
  age = 0;
  status = "";
  createdAt: Date = new Date(0);
}

/** `list` slot — a leaner projection for list responses. */
export class UserListDto {
  id = 0;
  name = "";
  email = "";
  status = "";
}
