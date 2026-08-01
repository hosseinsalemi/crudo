import type { KavoContext, EntityId, EntityMetadata, NormalizedQueryContext, RepositoryAdapter } from "@kavo/core";
import { NotFoundException } from "@kavo/core";

/** Test entity: plain class, fields initialized so shapes exist at runtime. */
export class User {
  id = 0;
  name = "";
  email = "";
  age = 0;
  status: "active" | "pending" | "banned" = "active";
  createdAt: Date = new Date(0);
}

export const userMetadata: EntityMetadata<User> = {
  entity: User,
  name: "User",
  idField: "id",
  fields: [
    { name: "id", kind: "number", nullable: false, generated: true },
    { name: "name", kind: "string", nullable: false, generated: false },
    { name: "email", kind: "string", nullable: false, generated: false },
    { name: "age", kind: "number", nullable: false, generated: false },
    {
      name: "status",
      kind: "enum",
      nullable: false,
      generated: false,
      enumValues: ["active", "pending", "banned"],
    },
    { name: "createdAt", kind: "date", nullable: false, generated: true },
  ],
  relations: [],
};

/**
 * In-memory adapter for engine tests: honors pagination and records the
 * queries it receives; filter evaluation is the *database's* job and is
 * covered by the @kavo/typeorm integration tests, not re-implemented
 * here.
 */
export class InMemoryUserAdapter implements RepositoryAdapter<User> {
  rows: User[] = [];
  lastQuery: NormalizedQueryContext<User> | null = null;
  private nextId = 1;

  async findOneById(id: EntityId): Promise<User | null> {
    return this.rows.find((row) => row.id === Number(id)) ?? null;
  }

  async findOne(query: NormalizedQueryContext<User>): Promise<User | null> {
    this.lastQuery = query;
    return this.rows[0] ?? null;
  }

  async findMany(query: NormalizedQueryContext<User>): Promise<readonly User[]> {
    this.lastQuery = query;
    const { offset, limit } = query.pagination;
    return this.rows.slice(offset, offset + limit);
  }

  async count(_query: NormalizedQueryContext<User>): Promise<number> {
    return this.rows.length;
  }

  async create(data: Partial<User>): Promise<User> {
    const row = {
      ...new User(),
      ...data,
      id: this.nextId++,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async update(id: EntityId, data: Partial<User>): Promise<User> {
    const row = await this.require(id);
    Object.assign(row, data);
    return row;
  }

  async patch(id: EntityId, data: Partial<User>): Promise<User> {
    return this.update(id, data);
  }

  async delete(id: EntityId): Promise<void> {
    await this.require(id);
    this.rows = this.rows.filter((row) => row.id !== Number(id));
  }

  async restore(): Promise<User> {
    throw new Error("User is not soft-deletable");
  }

  async purge(id: EntityId): Promise<void> {
    await this.delete(id);
  }

  private async require(id: EntityId): Promise<User> {
    const row = await this.findOneById(id);
    if (row === null) {
      throw new NotFoundException({
        messageParams: { entity: "User", id: String(id) },
      });
    }
    return row;
  }
}

export function contextStub(): KavoContext<User> {
  return {} as KavoContext<User>;
}
