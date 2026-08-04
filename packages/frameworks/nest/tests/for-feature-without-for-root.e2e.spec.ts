import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Controller } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigurationException } from "@kavo/core";
import { Kavo, KavoModule } from "@kavo/nest";
import { InMemoryTodoAdapter, Todo, fakeInfrastructure } from "./support/fake-infrastructure.js";

/**
 * Issue #7: `forFeature` provides per-entity services out of the root
 * instance, so without `forRoot`/`forRootAsync` in the graph its factory
 * has nothing to build from. That used to surface as Nest's own
 * "Nest can't resolve dependencies of the KAVO_INSTANCE (?)" — a token the
 * developer never typed, with no hint of the call that was missing.
 *
 * Its own file for the same reason `for-feature-registry.e2e.spec.ts` has
 * one: the `@Kavo` registry is a process-wide singleton, and a suite that
 * decorates one class per file is the only place the no-arg form is
 * unambiguous.
 */

@Kavo(Todo)
@Controller("todos")
class LonelyTodoController {}

describe("KavoModule.forFeature without forRoot", () => {
  const compileFeatureOnly = (): Promise<unknown> =>
    Test.createTestingModule({ imports: [KavoModule.forFeature([LonelyTodoController])] }).compile();

  it("fails with a ConfigurationException naming the call that is missing", async () => {
    await expect(compileFeatureOnly()).rejects.toBeInstanceOf(ConfigurationException);
    const error = (await compileFeatureOnly().catch((thrown: unknown) => thrown)) as ConfigurationException;
    expect(error.code).toBe("KAVO_CONFIG_INVALID");
    expect(error.context.entityName).toBe("Todo");
    expect(error.detail).toContain("KavoModule.forRoot({ infrastructure })");
    expect(error.detail).toContain("forRootAsync");
    // The point of the change: the message no longer leads with an internal
    // DI token nobody wrote.
    expect(error.detail).not.toContain("KAVO_INSTANCE");
  });

  it("says the same thing for the no-argument, registry-driven form", async () => {
    await expect(Test.createTestingModule({ imports: [KavoModule.forFeature()] }).compile()).rejects.toBeInstanceOf(
      ConfigurationException,
    );
  });

  it("still resolves normally once forRoot is in the graph", async () => {
    // The optional injection must not turn a real wiring bug into a silent
    // success, nor break the wiring that always worked.
    const moduleRef = await Test.createTestingModule({
      imports: [
        KavoModule.forRoot({ infrastructure: fakeInfrastructure(new InMemoryTodoAdapter()) }),
        KavoModule.forFeature([LonelyTodoController]),
      ],
    }).compile();
    await expect(moduleRef.init()).resolves.toBeDefined();
    await moduleRef.close();
  });
});
