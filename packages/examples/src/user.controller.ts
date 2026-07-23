import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { User } from "./user.entity.js";
import { CreateUserDto, UpdateUserDto, UserItemDto, UserListDto } from "./user.dtos.js";

/**
 * The whole Milestone B developer surface: one decorator, zero methods.
 * Routes are generated from the operation registry —
 * POST /users, GET /users, GET/PUT/PATCH/DELETE /users/:id — with the
 * Phase 5 query grammar on the list route and problem-details errors.
 */
@Crud(User, {
  dto: {
    create: CreateUserDto,
    update: UpdateUserDto,
    item: UserItemDto,
    list: UserListDto,
  },
  pagination: { defaultLimit: 10, maxLimit: 50 },
})
@Controller("users")
export class UserController {}
