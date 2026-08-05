import type {
  KavoContext,
  EntityId,
  EntityMetadata,
  NormalizedQueryContext,
  RelationDescriptor,
  RepositoryAdapter,
} from "@kavo/core";
import { NotFoundException, isCursorPagination } from "@kavo/core";

/**
 * A small relation graph for include tests:
 * `Author 1—* Post 1—* Comment`, plus `Post *—1 Author` back-edge so a
 * path can revisit a type and exercise the depth-based cycle guard.
 */
export class Author {
  id = 0;
  name = "";
  posts: Post[] = [];
}

export class Post {
  id = 0;
  title = "";
  authorId = 0;
  author: Author | null = null;
  comments: Comment[] = [];
  deletedAt: Date | null = null;
}

export class Comment {
  id = 0;
  body = "";
  postId = 0;
}

const relation = (name: string, target: () => never, cardinality: "one" | "many"): RelationDescriptor => ({
  name,
  target: target as unknown as () => never,
  cardinality,
  includable: false,
  strategy: "auto",
});

export const authorMetadata: EntityMetadata<Author> = {
  entity: Author,
  name: "Author",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "name", kind: "string", nullable: false, generated: false },
  ],
  relations: [relation("posts", () => Post as never, "many")],
};

export const postMetadata: EntityMetadata<Post> = {
  entity: Post,
  name: "Post",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "title", kind: "string", nullable: false, generated: false },
    { name: "authorId", kind: "number", nullable: false, generated: false },
    { name: "deletedAt", kind: "date", nullable: true, generated: true },
  ],
  relations: [relation("author", () => Author as never, "one"), relation("comments", () => Comment as never, "many")],
  softDeleteField: "deletedAt",
};

export const commentMetadata: EntityMetadata<Comment> = {
  entity: Comment,
  name: "Comment",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "body", kind: "string", nullable: false, generated: false },
    { name: "postId", kind: "number", nullable: false, generated: false },
  ],
  relations: [],
};

/**
 * Adapter that hands back whatever rows it was seeded with, already
 * stitched. Loading is a real adapter's job (covered against SQLite in
 * @kavo/typeorm); what these tests need from it is a row shaped the way
 * a loader would produce one, so serialization can be observed.
 */
export class SeededAdapter<Entity extends object> implements RepositoryAdapter<Entity> {
  lastQuery: NormalizedQueryContext<Entity> | null = null;

  constructor(public rows: Entity[] = []) {}

  async findOneById(id: EntityId, query: NormalizedQueryContext<Entity> | null): Promise<Entity | null> {
    this.lastQuery = query;
    return this.rows.find((row) => (row as { id?: unknown }).id === Number(id)) ?? null;
  }

  async findOne(query: NormalizedQueryContext<Entity>): Promise<Entity | null> {
    this.lastQuery = query;
    return this.rows[0] ?? null;
  }

  async findMany(query: NormalizedQueryContext<Entity>): Promise<readonly Entity[]> {
    this.lastQuery = query;
    // Offset-only fixture: narrow rather than assume (ADR-0021).
    const offset = isCursorPagination(query.pagination) ? 0 : query.pagination.offset;
    return this.rows.slice(offset, offset + query.pagination.limit);
  }

  async count(query: NormalizedQueryContext<Entity>): Promise<number> {
    this.lastQuery = query;
    return this.rows.length;
  }

  async create(data: Partial<Entity>): Promise<Entity> {
    const row = { id: this.rows.length + 1, ...data } as Entity;
    this.rows.push(row);
    return row;
  }

  async update(id: EntityId, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity> {
    const row = await this.findOneById(id, null);
    if (row === null) {
      throw new NotFoundException({ messageParams: { entity: context.entityName, id: String(id) } });
    }
    Object.assign(row, data);
    return row;
  }

  async patch(id: EntityId, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity> {
    return this.update(id, data, context);
  }

  async delete(): Promise<void> {}

  async restore(): Promise<Entity> {
    throw new Error("not soft-deletable in this fixture");
  }

  async purge(): Promise<void> {}
}
