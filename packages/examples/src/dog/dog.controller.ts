import { Controller } from "@nestjs/common";
import { Crud } from "@kavo/nest";
import { Dog } from "./dog.entity.js";

/**
 * CRUD over the concrete `Dog` subtype. Uses the root default pagination
 * (defaultLimit 20, maxLimit 100) — no entity-scope override. No `dto` block:
 * every slot falls back to the entity-derived default (`DefaultDtoResolver`),
 * so requests/responses are shaped straight from `Dog`'s own TypeORM columns
 * rather than a hand-written DTO. `DogItemDto`/`DogListDto` (`dog.dtos.ts`)
 * still exist and are used by `owner.dtos.ts` for the polymorphic `pets`
 * union — that usage is independent of this route's own config.
 */
@Crud(Dog)
@Controller("dogs")
export class DogController {}
