import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Controller } from "@nestjs/common";
import { Crud, getCrudEntities } from "@kavo/nest";
import { Todo } from "./support/fake-infrastructure.js";

/**
 * `getCrudEntities()` is the public, read-only counterpart of the
 * `forFeature()`-internal registry — a second binding's way to discover
 * every `@Crud` entity without a hand-kept list. Vitest isolates modules
 * per file (see `for-feature-registry.e2e.spec.ts`), so this file is the
 * only place a single `@Crud(Todo)` class is guaranteed to be the sole
 * registrant.
 */
@Crud(Todo)
@Controller("only-todos")
class OnlyTodoController {}

describe("getCrudEntities", () => {
  it("lists every @Crud-decorated entity registered so far", () => {
    expect(OnlyTodoController).toBeDefined();
    const entities = getCrudEntities();
    expect(entities).toHaveLength(1);
    expect(entities[0]?.entity).toBe(Todo);
  });
});
