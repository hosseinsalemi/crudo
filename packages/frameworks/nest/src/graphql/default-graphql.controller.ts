import { Body, Controller, HttpCode, Post, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { BaseCrudGraphQLController } from "./base-crud-graphql.controller.js";

/** `KavoModule.forRoot`/`forRootAsync({ graphql: true })`'s default mount path when no `path` override is given. */
export const DEFAULT_GRAPHQL_PATH = "graphql";

/**
 * Builds the zero-config GraphQL controller at `path` — one `POST <path>`,
 * mounted by `KavoModule.forRoot`/`forRootAsync` when `graphql` is set,
 * with no hand-written controller needed. A fresh class per call (never a
 * shared singleton) so two independently-configured Kavo modules in the
 * same process — two apps, or two test files sharing a module cache —
 * never fight over one `@Controller` path.
 *
 * The class is declared with real `@Controller`/`@Post`/`@HttpCode`
 * decorator syntax (closing over `path`), not built by calling those
 * decorators as plain functions afterward: `emitDecoratorMetadata` only
 * emits `design:paramtypes` for a class tsc sees an actual decorator
 * applied to, so the constructor's `ModuleRef` injection silently breaks
 * without it.
 *
 * A consumer wanting a different method, auth guard, or transport
 * (subscriptions, batched requests) writes their own controller extending
 * `BaseCrudGraphQLController` instead and leaves `graphql` unset — this
 * factory and a custom controller are alternatives, never both at once.
 */
export function createDefaultGraphQLController(path: string = DEFAULT_GRAPHQL_PATH): Type<BaseCrudGraphQLController> {
  @Controller(path)
  class DefaultGraphQLController extends BaseCrudGraphQLController {
    constructor(moduleRef: ModuleRef) {
      super(moduleRef);
    }

    @Post()
    @HttpCode(200)
    handle(@Body() body: { query: string; variables?: Record<string, unknown> }) {
      return this.execute(body.query, body.variables);
    }
  }

  return DefaultGraphQLController;
}
