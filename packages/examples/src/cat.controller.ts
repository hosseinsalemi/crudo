import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { Cat } from "./cat.entity.js";
import { CreateCatDto, UpdateCatDto, CatItemDto, CatListDto } from "./cat.dtos.js";

/**
 * CRUD over the concrete `Cat` subtype: one decorator, zero methods.
 * Binding `@Crud` to the child (never the abstract `Pet` base) lets the
 * child repository auto-write the `species` discriminator on create.
 * Routes: POST /cats, GET /cats, GET/PUT/PATCH/DELETE /cats/:id.
 */
@Crud(Cat, {
  dto: {
    create: CreateCatDto,
    update: UpdateCatDto,
    item: CatItemDto,
    list: CatListDto,
  },
  pagination: { defaultLimit: 10, maxLimit: 50 },
})
@Controller("cats")
export class CatController {}
