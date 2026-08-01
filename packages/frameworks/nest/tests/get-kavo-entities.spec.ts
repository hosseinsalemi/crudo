import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Controller } from "@nestjs/common";
import { Kavo, getKavoEntities } from "@kavo/nest";
import { Todo } from "./support/fake-infrastructure.js";

/**
 * `getKavoEntities()` is the public, read-only counterpart of the
 * `forFeature()`-internal registry — a second binding's way to discover
 * every `@Kavo` entity without a hand-kept list. Vitest isolates modules
 * per file (see `for-feature-registry.e2e.spec.ts`), so this file is the
 * only place a single `@Kavo(Todo)` class is guaranteed to be the sole
 * registrant.
 */
@Kavo(Todo)
@Controller("only-todos")
class OnlyTodoController {}

describe("getKavoEntities", () => {
  it("lists every @Kavo-decorated entity registered so far", () => {
    expect(OnlyTodoController).toBeDefined();
    const entities = getKavoEntities();
    expect(entities).toHaveLength(1);
    expect(entities[0]?.entity).toBe(Todo);
  });
});
