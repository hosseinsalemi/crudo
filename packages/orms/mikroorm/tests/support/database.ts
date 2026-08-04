import { MikroORM, type EntityClass } from "@mikro-orm/core";
import { defineConfig } from "@mikro-orm/sqlite";

/**
 * One in-memory SQLite database per spec file, with the schema created from
 * the entity metadata — the same "real driver, not mocks" posture the other
 * adapters' suites take.
 *
 * `allowGlobalContext` stays off (its default): the adapter forks an
 * `EntityManager` for every operation, and a test that reaches for `orm.em`
 * directly instead of `orm.em.fork()` should fail loudly rather than share
 * an identity map with the code under test.
 */
export async function newTestOrm(entities: readonly EntityClass<object>[]): Promise<MikroORM> {
  const orm = await MikroORM.init(
    defineConfig({
      dbName: ":memory:",
      entities: entities as EntityClass<object>[],
    }),
  );
  await orm.schema.create();
  return orm;
}

/**
 * Empty every table between tests. `clearDatabase` also resets MikroORM's
 * identity map, which matters because the seeding helpers below fork their
 * own `EntityManager`s.
 */
export async function clearDatabase(orm: MikroORM): Promise<void> {
  await orm.schema.clear();
}
