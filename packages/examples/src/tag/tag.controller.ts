import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { Tag } from "./tag.entity.js";
import { CreateTagDto, UpdateTagDto, TagItemDto, TagListDto } from "./tag.dtos.js";

/**
 * Plain CRUD over `Tag`, the many-to-many side pets associate by id
 * (`include=tags` on `/cats`, Phase 15).
 */
@Crud(Tag, {
  dto: {
    create: CreateTagDto,
    update: UpdateTagDto,
    item: TagItemDto,
    list: TagListDto,
  },
})
@Controller("tags")
export class TagController {}
