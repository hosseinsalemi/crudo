import type {
  ClassRef,
  CrudInfrastructure,
  EntityId,
  EntityMetadata,
  NormalizedQueryContext,
  RepositoryAdapter,
} from "@crudo/core";
import { NotFoundException } from "@crudo/core";

/** Test entity for binding tests — no ORM anywhere near this package. */
export class Todo {
  id = 0;
  title = "";
  done = false;
  priority = 0;
}

export const todoMetadata: EntityMetadata<Todo> = {
  entity: Todo,
  name: "Todo",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "title", kind: "string", nullable: false, generated: false },
    { name: "done", kind: "boolean", nullable: false, generated: false },
    { name: "priority", kind: "number", nullable: false, generated: false },
  ],
  relations: [],
};

/**
 * In-memory adapter for the binding tests: pagination honored, the last
 * normalized query recorded so tests can assert the wire → AST wiring.
 * Filter *evaluation* belongs to real adapters (covered in
 * @crudo/typeorm's suite); the binding's job ends at handing the adapter
 * a validated query.
 */
export class InMemoryTodoAdapter implements RepositoryAdapter<Todo> {
  rows: Todo[] = [];
  lastQuery: NormalizedQueryContext<Todo> | null = null;
  private nextId = 1;

  async findOneById(id: EntityId): Promise<Todo | null> {
    return this.rows.find((row) => row.id === Number(id)) ?? null;
  }

  async findOne(query: NormalizedQueryContext<Todo>): Promise<Todo | null> {
    this.lastQuery = query;
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
    throw new Error("restore lands in Phase 15");
  }

  async purge(): Promise<void> {
    throw new Error("purge lands in Phase 15");
  }

  private async require(id: EntityId): Promise<Todo> {
    const row = await this.findOneById(id);
    if (row === null) {
      throw new NotFoundException({
        messageParams: { entity: "Todo", id: String(id) },
      });
    }
    return row;
  }
}

export function fakeInfrastructure(adapter: InMemoryTodoAdapter): CrudInfrastructure {
  return {
    metadataFor<Entity extends object>(entity: ClassRef<Entity>) {
      if ((entity as ClassRef) !== Todo) {
        throw new Error(`no metadata for ${entity.name}`);
      }
      return todoMetadata as unknown as EntityMetadata<Entity>;
    },
    adapterFor<Entity extends object>() {
      return adapter as unknown as RepositoryAdapter<Entity>;
    },
  };
}
