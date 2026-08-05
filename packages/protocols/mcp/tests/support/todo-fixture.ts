import type { EntityId, EntityMetadata, NormalizedQueryContext, RepositoryAdapter } from "@kavo/core";
import { NotFoundException, hasKeyset } from "@kavo/core";

/** Test entity for the MCP binding — no ORM, no Nest anywhere near this package. */
export class Todo {
  id = 0;
  title = "";
  done = false;
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

/** In-memory adapter, same shape as `@kavo/graphql`'s own test fixture — no database needed to prove the binding. */
export class InMemoryTodoAdapter implements RepositoryAdapter<Todo> {
  rows: Todo[] = [];
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
    const { limit } = query.pagination;
    // Offset-only fixture: narrow rather than assume (ADR-0021).
    const offset = hasKeyset(query.pagination) ? 0 : query.pagination.offset;
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
    const { limit } = query.pagination;
    // Offset-only fixture: narrow rather than assume (ADR-0021).
    const offset = hasKeyset(query.pagination) ? 0 : query.pagination.offset;
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
