import { Controller } from "@nestjs/common";
import { Crud } from "@kavo/nest";
import { Cat } from "./cat.entity.js";
import { CreateCatDto, UpdateCatDto, CatItemDto, CatListDto } from "./cat.dtos.js";

/**
 * CRUD over the concrete `Cat` subtype: one decorator, zero methods.
 * Binding `@Crud` to the child (never the abstract `Pet` base) lets the
 * child repository auto-write the `species` discriminator on create.
 * Routes: POST /cats, GET /cats, GET/PUT/DELETE /cats/:id (PATCH disabled).
 * `include=owner` embeds the owner; `owner` is also writable by id
 * (`{"owner": 1}` on create — ADR-0014). `include=tags` embeds the cat's
 * tags (a many-to-many, batch-loaded like any other to-many); `tags` is
 * likewise writable by an array of ids.
 */
@Crud(Cat, {
  dto: {
    create: CreateCatDto,
    update: UpdateCatDto,
    item: CatItemDto,
    list: CatListDto,
  },
  pagination: { defaultLimit: 10, maxLimit: 50 },
  // The to-one side of the owner edge joins; `tags` is a to-many (many-to-
  // many) and batches. `fields[owner]=id,name` / `fields[tags]=id,name`
  // narrow each embedded relation.
  relations: { edges: { owner: { includable: true }, tags: { includable: true } } },
  operations: {
    patchOne: false,
  },
})
@Controller("cats")
export class CatController {}
