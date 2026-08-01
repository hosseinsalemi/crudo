import type { KavoContext, EntityId, EntityMetadata, NormalizedQueryContext, RepositoryAdapter } from "@kavo/core";
import { NotFoundException } from "@kavo/core";

/** Third entity — the only one that's soft-deletable, so `restoreOne`/`purgeOne` have something real to exercise. */
export class Note {
  id = 0;
  text = "";
  deletedAt: Date | null = null;
}

export const noteMetadata: EntityMetadata<Note> = {
  entity: Note,
  name: "Note",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "text", kind: "string", nullable: false, generated: false },
    { name: "deletedAt", kind: "date", nullable: true, generated: true },
  ],
  relations: [],
  softDeleteField: "deletedAt",
};

export class InMemoryNoteAdapter implements RepositoryAdapter<Note> {
  rows: Note[] = [];
  private nextId = 1;

  async findOneById(id: EntityId): Promise<Note | null> {
    return this.rows.find((row) => row.id === Number(id) && row.deletedAt === null) ?? null;
  }

  async findOne(): Promise<Note | null> {
    return this.rows.find((row) => row.deletedAt === null) ?? null;
  }

  async findMany(query: NormalizedQueryContext<Note>): Promise<readonly Note[]> {
    const { offset, limit } = query.pagination;
    return this.rows.filter((row) => row.deletedAt === null).slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.rows.filter((row) => row.deletedAt === null).length;
  }

  async create(data: Partial<Note>): Promise<Note> {
    const row = { ...new Note(), ...data, id: this.nextId++ };
    this.rows.push(row);
    return row;
  }

  async update(id: EntityId, data: Partial<Note>): Promise<Note> {
    const row = await this.requireLive(id);
    Object.assign(row, data);
    return row;
  }

  async patch(id: EntityId, data: Partial<Note>): Promise<Note> {
    return this.update(id, data);
  }

  async delete(id: EntityId): Promise<void> {
    const row = await this.requireLive(id);
    row.deletedAt = new Date();
  }

  async restore(id: EntityId): Promise<Note> {
    const row = await this.requireAny(id);
    row.deletedAt = null;
    return row;
  }

  async purge(id: EntityId): Promise<void> {
    await this.requireAny(id);
    this.rows = this.rows.filter((candidate) => candidate.id !== Number(id));
  }

  private async requireLive(id: EntityId): Promise<Note> {
    const row = this.rows.find((candidate) => candidate.id === Number(id) && candidate.deletedAt === null) ?? null;
    if (row === null) {
      throw new NotFoundException({ messageParams: { entity: "Note", id: String(id) } });
    }
    return row;
  }

  private async requireAny(id: EntityId): Promise<Note> {
    const row = this.rows.find((candidate) => candidate.id === Number(id)) ?? null;
    if (row === null) {
      throw new NotFoundException({ messageParams: { entity: "Note", id: String(id) } });
    }
    return row;
  }
}

/** Test entity for the GraphQL binding — no ORM, no Nest anywhere near this package. */
export class Todo {
  id = 0;
  title = "";
  done = false;
}

/** Second entity — exists only to prove `mergeKavoGraphQLSchemas` puts two entities on one root without colliding. */
export class Tag {
  id = 0;
  label = "";
}

export const tagMetadata: EntityMetadata<Tag> = {
  entity: Tag,
  name: "Tag",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "label", kind: "string", nullable: false, generated: false },
  ],
  relations: [],
};

export class InMemoryTagAdapter implements RepositoryAdapter<Tag> {
  rows: Tag[] = [];
  private nextId = 1;

  async findOneById(id: EntityId): Promise<Tag | null> {
    return this.rows.find((row) => row.id === Number(id)) ?? null;
  }

  async findOne(): Promise<Tag | null> {
    return this.rows[0] ?? null;
  }

  async findMany(query: NormalizedQueryContext<Tag>): Promise<readonly Tag[]> {
    const { offset, limit } = query.pagination;
    return this.rows.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async create(data: Partial<Tag>): Promise<Tag> {
    const row = { ...new Tag(), ...data, id: this.nextId++ };
    this.rows.push(row);
    return row;
  }

  async update(id: EntityId, data: Partial<Tag>): Promise<Tag> {
    const row = await this.require(id);
    Object.assign(row, data);
    return row;
  }

  async patch(id: EntityId, data: Partial<Tag>): Promise<Tag> {
    return this.update(id, data);
  }

  async delete(id: EntityId): Promise<void> {
    await this.require(id);
    this.rows = this.rows.filter((row) => row.id !== Number(id));
  }

  async restore(): Promise<Tag> {
    throw new Error("Tag is not soft-deletable");
  }

  async purge(id: EntityId): Promise<void> {
    await this.delete(id);
  }

  private async require(id: EntityId): Promise<Tag> {
    const row = await this.findOneById(id);
    if (row === null) {
      throw new NotFoundException({ messageParams: { entity: "Tag", id: String(id) } });
    }
    return row;
  }
}

export const todoMetadata: EntityMetadata<Todo> = {
  entity: Todo,
  name: "Todo",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "title", kind: "string", nullable: false, generated: false },
    { name: "done", kind: "boolean", nullable: false, generated: false },
  ],
  relations: [],
};

/** In-memory adapter, same shape as core's own test fixtures — no database needed to prove the binding. */
export class InMemoryTodoAdapter implements RepositoryAdapter<Todo> {
  rows: Todo[] = [];
  /** Records the normalized query `findMany` last received — filter/sort *evaluation* is a real adapter's job (@kavo/typeorm's), not re-implemented here; this just proves the GraphQL binding wired them through. */
  lastQuery: NormalizedQueryContext<Todo> | null = null;
  private nextId = 1;

  async findOneById(id: EntityId): Promise<Todo | null> {
    return this.rows.find((row) => row.id === Number(id)) ?? null;
  }

  async findOne(): Promise<Todo | null> {
    return this.rows[0] ?? null;
  }

  async findMany(query: NormalizedQueryContext<Todo>): Promise<readonly Todo[]> {
    this.lastQuery = query;
    const { offset, limit } = query.pagination;
    return this.rows.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async create(data: Partial<Todo>): Promise<Todo> {
    const row = { ...new Todo(), ...data, id: this.nextId++ };
    this.rows.push(row);
    return row;
  }

  async update(id: EntityId, data: Partial<Todo>): Promise<Todo> {
    const row = await this.require(id);
    Object.assign(row, data);
    return row;
  }

  async patch(id: EntityId, data: Partial<Todo>): Promise<Todo> {
    return this.update(id, data);
  }

  async delete(id: EntityId): Promise<void> {
    await this.require(id);
    this.rows = this.rows.filter((row) => row.id !== Number(id));
  }

  async restore(): Promise<Todo> {
    throw new Error("Todo is not soft-deletable");
  }

  async purge(id: EntityId): Promise<void> {
    await this.delete(id);
  }

  private async require(id: EntityId): Promise<Todo> {
    const row = await this.findOneById(id);
    if (row === null) {
      throw new NotFoundException({ messageParams: { entity: "Todo", id: String(id) } });
    }
    return row;
  }
}

export function contextStub(): KavoContext<Todo> {
  return {} as KavoContext<Todo>;
}
