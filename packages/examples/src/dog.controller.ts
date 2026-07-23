import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { Dog } from "./dog.entity.js";
import { CreateDogDto, UpdateDogDto, DogItemDto, DogListDto } from "./dog.dtos.js";

/**
 * CRUD over the concrete `Dog` subtype. Uses the root default pagination
 * (defaultLimit 20, maxLimit 100) — no entity-scope override.
 */
@Crud(Dog, {
  dto: {
    create: CreateDogDto,
    update: UpdateDogDto,
    item: DogItemDto,
    list: DogListDto,
  },
})
@Controller("dogs")
export class DogController {}
