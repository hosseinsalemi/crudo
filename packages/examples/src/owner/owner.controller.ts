import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { Owner } from "./owner.entity.js";
import { CreateOwnerDto, UpdateOwnerDto, OwnerItemDto, OwnerListDto } from "./owner.dtos.js";

/**
 * CRUD over the relation side. The unique `email` column is what surfaces a
 * database unique-violation as an RFC 9457 409 conflict.
 *
 * Soft delete (Phase 14): declaring `strategy: "soft"` is what puts
 * `PATCH /owners/:id/restore` on the router — route generation runs before
 * any ORM metadata exists, so the config, not the entity, is what it can
 * read (ADR-0013). `purgeOne` is off by default everywhere; asked for by
 * name it adds `DELETE /owners/:id/purge`.
 */
@Crud(Owner, {
  dto: {
    create: CreateOwnerDto,
    update: UpdateOwnerDto,
    item: OwnerItemDto,
    list: OwnerListDto,
  },
  softDelete: { strategy: "soft" },
  operations: {
    purgeOne: true,
  },
})
@Controller("owners")
export class OwnerController {}
