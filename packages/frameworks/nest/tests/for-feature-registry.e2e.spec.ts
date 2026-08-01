import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DefaultKavoService } from "@kavo/core";
import { Kavo, KavoModule, getKavoServiceToken } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

/**
 * `KavoModule.forFeature()` called with no arguments provides every
 * `@Kavo`-decorated class the *process* has seen — the registry in
 * `kavo.decorator.ts` is a module-level singleton. Vitest isolates modules
 * per test file, so this file is the only place a single `@Kavo(Todo, ...)`
 * class is guaranteed to be the sole registrant; every other suite in this
 * package (`binding.e2e.spec.ts`, `settings.e2e.spec.ts`) declares many
 * differently-configured `@Kavo(Todo, ...)` classes and always passes
 * `forFeature` an explicit array for exactly that reason.
 */

let app: INestApplication;

afterEach(async () => {
  await app.close();
});

@Kavo(Todo)
@Controller("todos")
class OnlyTodoController {}

describe("KavoModule.forFeature() — no-arg, discovery-driven registry", () => {
  it("binds the controller via discovery and provides the token from the process-wide registry", async () => {
    const adapter = new InMemoryTodoAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [KavoModule.forRoot({ infrastructure: fakeInfrastructure(adapter) }), KavoModule.forFeature()],
      controllers: [OnlyTodoController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const created = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/todos")
      .send({ title: "x" })
      .expect(201);
    expect(created.body).toMatchObject({ title: "x" });

    const service = app.get<DefaultKavoService<Todo>>(getKavoServiceToken(Todo));
    expect(service).toBeDefined();
    const found = await service.findOne(created.body.id as number);
    expect(found).toMatchObject({ title: "x" });
  });
});
