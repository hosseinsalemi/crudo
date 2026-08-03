import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Controller, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Kavo, KavoModule } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";
import { listen, type SupertestTarget } from "./support/listen.js";

/**
 * Pins the contract every HTTP suite in this package leans on (issue #91):
 * `listen(app)` leaves the app bound, on the loopback — the exact address
 * supertest connects to — *before* the first request. Under the `app.init()`
 * bootstrap this replaced, the server was unbound, so supertest bound a
 * fresh wildcard port per request and raced every other local process for
 * it. Both assertions below fail outright against that bootstrap.
 */
@Kavo(Todo)
@Controller("todos")
class TodoController {}

let app: INestApplication;

afterEach(async () => {
  await app.close();
});

async function bootstrap(): Promise<SupertestTarget> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      KavoModule.forRoot({ infrastructure: fakeInfrastructure(new InMemoryTodoAdapter()) }),
      KavoModule.forFeature([TodoController]),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  return listen(app);
}

function boundAddress(server: SupertestTarget): AddressInfo {
  const address = (server as Server).address();
  if (address === null || typeof address === "string") throw new Error("server is not bound to a TCP address");
  return address;
}

describe("listen — the e2e bootstrap", () => {
  it("binds on the loopback before any request is made", async () => {
    const server = await bootstrap();
    expect(boundAddress(server).address).toBe("127.0.0.1");
  });

  it("serves every request over that one binding instead of a new one each time", async () => {
    const server = await bootstrap();
    const bound = boundAddress(server).port;

    await request(server).get("/todos").expect(200);
    await request(server).get("/todos").expect(200);

    expect(boundAddress(server).port).toBe(bound);
  });
});
