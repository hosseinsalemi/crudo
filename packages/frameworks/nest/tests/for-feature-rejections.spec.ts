import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Controller } from "@nestjs/common";
import { ConfigurationException } from "@kavo/core";
import { Kavo, KavoModule } from "@kavo/nest";
import { Todo } from "./support/fake-infrastructure.js";

/**
 * The two ways `KavoModule.forFeature` refuses to guess, both of which
 * throw synchronously at module-definition time rather than producing a
 * container that fails later.
 *
 * This needs its own file because the no-arg form reads the process-wide
 * registry in `kavo.decorator.ts`, and vitest isolates modules per test
 * file. `for-feature-registry.e2e.spec.ts` is the file whose premise is a
 * *single* registrant; this one's premise is two, so they cannot share.
 */

@Kavo(Todo)
@Controller("todos")
class FirstTodoController {}

@Kavo(Todo)
@Controller("archived-todos")
class SecondTodoController {}

describe("KavoModule.forFeature([...]) — an undecorated class", () => {
  it("refuses a class carrying no @Kavo metadata, naming it", () => {
    // Silently skipping it would leave the app booting with a route table
    // missing an entity the developer believes they registered.
    class PlainController {}

    expect(() => KavoModule.forFeature([PlainController])).toThrow(ConfigurationException);
    expect(() => KavoModule.forFeature([PlainController])).toThrow(/PlainController/);
    expect(() => KavoModule.forFeature([PlainController])).toThrow(/@Kavo/);
  });

  it("still accepts a decorated one alongside", () => {
    expect(() => KavoModule.forFeature([FirstTodoController])).not.toThrow();
  });
});

describe("KavoModule.forFeature() — two controllers claiming one entity", () => {
  it("refuses to pick, naming both controllers and the entity", () => {
    // Each `@Kavo` class carries its own config, so the provider for
    // `getKavoServiceToken(Todo)` would be whichever registered last —
    // a silent coin flip between two different service configurations.
    expect(() => KavoModule.forFeature()).toThrow(ConfigurationException);
    expect(() => KavoModule.forFeature()).toThrow(/FirstTodoController/);
    expect(() => KavoModule.forFeature()).toThrow(/SecondTodoController/);
    expect(() => KavoModule.forFeature()).toThrow(/Todo/);
  });

  it("points at the explicit-array form as the way out", () => {
    expect(() => KavoModule.forFeature()).toThrow(/explicit array/);
  });

  it("accepts the same two controllers when the array disambiguates them", () => {
    expect(() => KavoModule.forFeature([FirstTodoController, SecondTodoController])).not.toThrow();
  });
});
