import "reflect-metadata";
import { afterAll, beforeAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { registerCrudE2eSuite } from "./crud-e2e.suite.js";

/**
 * Same suite as `app.e2e.spec.ts`, run against a real Postgres instead of
 * in-memory SQLite. `DatabaseModule` (packages/examples/src/database.module.ts)
 * switches driver on `PGHOST`, which this test sets from a container it
 * provisions itself — no manual Postgres setup needed to run `pnpm check`.
 * `AppModule` must be imported after the env vars are set, since
 * `DatabaseModule`'s factory reads them at DI-resolution time.
 */
let container: StartedPostgreSqlContainer;
let app: INestApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  process.env.PGHOST = container.getHost();
  process.env.PGPORT = String(container.getPort());
  process.env.PGUSER = container.getUsername();
  process.env.PGPASSWORD = container.getPassword();
  process.env.PGDATABASE = container.getDatabase();

  const { AppModule } = await import("../src/app.module.js");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 120_000);

afterAll(async () => {
  if (app !== undefined) await app.close();
  if (container !== undefined) await container.stop();
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.PGDATABASE;
}, 30_000);

registerCrudE2eSuite(() => app);
