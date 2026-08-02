import "reflect-metadata";
import { afterAll, beforeAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { registerCrudE2eSuite } from "./crud-e2e.suite.js";

/**
 * The default suite: `mongodb-memory-server` runs a `mongod` against an
 * ephemeral data directory, so `pnpm check` gets the full Nest → engine →
 * Mongoose → MongoDB path with no Docker daemon and no manual setup.
 *
 * It is a standalone `mongod` of whatever version the tool downloads, which
 * is not what the app is deployed onto — `app-mongo.e2e.spec.ts` runs the
 * same assertions against a pinned, containerized MongoDB replica set.
 */
let server: MongoMemoryServer;
let app: INestApplication;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName: "kavo-examples" });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot()],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 60_000);

afterAll(async () => {
  if (app !== undefined) await app.close();
  await mongoose.disconnect();
  if (server !== undefined) await server.stop();
});

registerCrudE2eSuite(() => app);
