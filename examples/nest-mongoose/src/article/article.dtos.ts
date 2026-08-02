import { enumProp } from "@kavo/nest";
import { ArticleStatus } from "./article.model.js";

/**
 * DTO slots for the Article route. Fields are initialized so the classes
 * carry their shape at runtime — the same mechanism the Pet DTOs use.
 *
 * The one visible difference from a TypeORM entity is the identifier:
 * MongoDB's primary key is `_id`, and `@kavo/mongoose` renders it as a hex
 * **string** at the adapter boundary rather than widening core's
 * `EntityId` (ADR-0018). `deletedAt` is absent from every slot: it is the
 * soft-delete marker, driven by `deleteOne`/`restoreOne`.
 */

/** `create` slot — request body for POST /articles. */
export class CreateArticleDto {
  title = "";
  body = "";
  status = enumProp(Object.values(ArticleStatus), { example: ArticleStatus.Draft });
  tags: string[] = [];
  /** Association by id (ADR-0014) — the author's `_id` as a string. */
  author: string | null = null;
}

/** `update` slot — request body for PUT /articles/:id (patch derives from it). */
export class UpdateArticleDto {
  title = "";
  body = "";
  status = enumProp(Object.values(ArticleStatus), { example: ArticleStatus.Published });
  tags: string[] = [];
  author: string | null = null;
}

/** `item` slot — the detail projection. */
export class ArticleItemDto {
  _id = "";
  title = "";
  body = "";
  status = "";
  tags: string[] = [];
  createdAt = new Date();
}

/** `list` slot — leaner than `item`: no body, no timestamps. */
export class ArticleListDto {
  _id = "";
  title = "";
  status = "";
  tags: string[] = [];
}
