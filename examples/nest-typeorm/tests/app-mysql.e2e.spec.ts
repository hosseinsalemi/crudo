import "reflect-metadata";
import { afterAll, beforeAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MySqlContainer, type StartedMySqlContainer } from "@testcontainers/mysql";
import { AppModule } from "../src/app.module.js";
import { registerCrudE2eSuite } from "./crud-e2e.suite.js";

/**
 * Same suite as `app.e2e.spec.ts`, run against a real MySQL instead of
 * in-memory SQLite. `AppModule.forRoot(mysql)` takes the connection options
 * directly — no manual MySQL setup needed to run `pnpm check`, since the
 * options come from a container this test provisions itself.
 */
let container: StartedMySqlContainer;
let app: INestApplication;

beforeAll(async () => {
  container = await new MySqlContainer("mysql:8").start();

  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        type: "mysql",
        host: container.getHost(),
        port: container.getPort(),
        username: container.getUsername(),
        password: container.getUserPassword(),
        database: container.getDatabase(),
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 240_000);

afterAll(async () => {
  if (app !== undefined) await app.close();
  if (container !== undefined) await container.stop();
}, 30_000);

registerCrudE2eSuite(() => app);
