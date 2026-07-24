import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { Cat } from "./cat.entity.js";
import { CreateCatDto, UpdateCatDto, CatItemDto, CatListDto } from "./cat.dtos.js";

/**
 * CRUD over the concrete `Cat` subtype: one decorator, zero methods.
 * Binding `@Crud` to the child (never the abstract `Pet` base) lets the
 * child repository auto-write the `species` discriminator on create.
 * Routes: POST /cats, GET /cats, GET/PUT/DELETE /cats/:id (PATCH disabled).
 * `include=owner` embeds the owner; `owner` is also writable by id
 * (`{"owner": 1}` on create — ADR-0014).
 */
@Crud(Cat, {
  dto: {
    create: CreateCatDto,
    update: UpdateCatDto,
    item: CatItemDto,
    list: CatListDto,
  },
  pagination: { defaultLimit: 10, maxLimit: 50 },
  // The to-one side of the same edge: `include=owner` joins, and
  // `fields[owner]=id,name` narrows the embedded owner (Phase 15).
  relations: { edges: { owner: { includable: true } } },
  operations: {
    patchOne: false,
  },
})
@Controller("cats")
export class CatController {}
