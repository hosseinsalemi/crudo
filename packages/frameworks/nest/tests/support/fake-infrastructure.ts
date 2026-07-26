import type {
  ClassRef,
  CrudContext,
  CrudInfrastructure,
  EntityId,
  EntityMetadata,
  NormalizedQueryContext,
  RepositoryAdapter,
} from "@kavo/core";
import { AlreadyDeletedException, NotDeletedException, NotFoundException } from "@kavo/core";

/**
 * Test entity for binding tests — no ORM anywhere near this package. The
 * `deletedAt` marker makes it soft-deletable (Phase 14), which is what the
 * restore/purge route tests need.
 */
export class Todo {
  id = 0;
  title = "";
  done = false;
  priority = 0;
  deletedAt: Date | null = null;
  /** To-one relation, so `include=list` exercises the join path. */
  list: TodoList | null = null;
}

/** The other side of the relation — never routed, only included. */
export class TodoList {
  id = 0;
  name = "";
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
    { name: "deletedAt", kind: "date", nullable: true, generated: true },
  ],
  relations: [
    {
      name: "list",
      target: () => TodoList,
      cardinality: "one",
      includable: false,
      strategy: "auto",
    },
  ],
  softDeleteField: "deletedAt",
};

export const todoListMetadata: EntityMetadata<TodoList> = {
  entity: TodoList,
  name: "TodoList",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "name", kind: "string", nullable: false, generated: false },
  ],
  relations: [],
};

/**
 * In-memory adapter for the binding tests: pagination honored, the last
 * normalized query recorded so tests can assert the wire → AST wiring.
 * Filter *evaluation* belongs to real adapters (covered in
 * @kavo/typeorm's suite); the binding's job ends at handing the adapter
 * a validated query.
 */
export class InMemoryTodoAdapter implements RepositoryAdapter<Todo> {
  rows: Todo[] = [];
  lastQuery: NormalizedQueryContext<Todo> | null = null;
  private nextId = 1;

  async findOneById(
    id: EntityId,
    query: NormalizedQueryContext<Todo> | null,
    context: CrudContext<Todo>,
  ): Promise<Todo | null> {
    const row = this.rows.find((candidate) => candidate.id === Number(id)) ?? null;
    if (row === null) return null;
    return this.visible(row, context, query?.withDeleted ?? false) ? row : null;
  }

  async findOne(query: NormalizedQueryContext<Todo>, context: CrudContext<Todo>): Promise<Todo | null> {
    this.lastQuery = query;
    return this.live(query, context)[0] ?? null;
  }

  async findMany(query: NormalizedQueryContext<Todo>, context: CrudContext<Todo>): Promise<readonly Todo[]> {
    this.lastQuery = query;
    const { offset, limit } = query.pagination;
    return this.live(query, context).slice(offset, offset + limit);
  }

  async count(query: NormalizedQueryContext<Todo>, context: CrudContext<Todo>): Promise<number> {
    return this.live(query, context).length;
  }

  async create(data: Partial<Todo>): Promise<Todo> {
    const row = { ...new Todo(), ...data, id: this.nextId++ };
    // A relation arrives as an `{ id }` reference (Phase 15); a real
    // adapter would resolve it, and this fake keeps it as-is so the
    // binding tests can see what deserialization produced.
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

  async delete(id: EntityId, context: CrudContext<Todo>): Promise<void> {
    const row = await this.require(id);
    if (context.config.softDelete.strategy === "hard") {
      this.rows = this.rows.filter((candidate) => candidate.id !== Number(id));
      return;
    }
    if (row.deletedAt !== null) {
      throw new AlreadyDeletedException({
        messageParams: { entity: context.entityName, id: String(id) },
      });
    }
    row.deletedAt = new Date();
  }

  /**
   * Soft delete, driven by the strategy the engine resolved rather than by
   * this fake's own opinion — `deletedAt` is a plain property here, which
   * is exactly what a marker column is (Phase 14).
   */
  async restore(id: EntityId, context: CrudContext<Todo>): Promise<Todo> {
    const row = await this.require(id);
    if (row.deletedAt === null) {
      throw new NotDeletedException({
        messageParams: { entity: context.entityName, id: String(id) },
      });
    }
    row.deletedAt = null;
    return row;
  }

  async purge(id: EntityId, context: CrudContext<Todo>): Promise<void> {
    const row = await this.require(id);
    if (context.config.softDelete.strategy === "soft" && row.deletedAt === null) {
      throw new NotDeletedException({
        messageParams: { entity: context.entityName, id: String(id) },
      });
    }
    this.rows = this.rows.filter((candidate) => candidate.id !== Number(id));
  }

  private live(query: NormalizedQueryContext<Todo>, context: CrudContext<Todo>): readonly Todo[] {
    return this.rows.filter((row) => this.visible(row, context, query.withDeleted));
  }

  private visible(row: Todo, context: CrudContext<Todo>, withDeleted: boolean): boolean {
    if (context.config.softDelete.strategy !== "soft") return true;
    return withDeleted || row.deletedAt === null;
  }

  private async require(id: EntityId): Promise<Todo> {
    const row = this.rows.find((candidate) => candidate.id === Number(id)) ?? null;
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
      if ((entity as ClassRef) === TodoList) {
        return todoListMetadata as unknown as EntityMetadata<Entity>;
      }
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
