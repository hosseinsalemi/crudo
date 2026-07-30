import type { OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { resolveCrudGraphQLSchema } from "@kavo/graphql";
import { graphql, type ExecutionResult, type GraphQLSchema } from "graphql";
import { getCrudEntities } from "../crud.decorator.js";
import { getCrudServiceToken } from "../tokens.js";

/**
 * Nest-side half of the `@kavo/graphql` glue: discovers every `@Crud`
 * entity that also called `registerCrudGraphQLTypes` and merges them onto
 * one schema, the same moment `KavoCrudBinder` does its own discovery pass
 * (`onModuleInit`, after every controller file has been imported). All the
 * actual schema-building is `@kavo/graphql`'s `resolveCrudGraphQLSchema` —
 * this class only supplies the two Nest-specific pieces that function
 * deliberately doesn't know about: how to enumerate `@Crud` entities
 * (`getCrudEntities()`) and how to resolve one's bound service (`ModuleRef`
 * + `getCrudServiceToken`). A future `@kavo/express`/`@kavo/fastify` binding
 * would supply its own version of just those two things and reuse the same
 * `resolveCrudGraphQLSchema` call.
 *
 * `@kavo/graphql` itself stays framework-agnostic — it never imports
 * `@kavo/nest` (`graphql-only-imports-core` in `.dependency-cruiser.cjs`,
 * ADR-0016) — so this controller is the only place the two meet. A
 * concrete controller just adds the `@Controller` decorator and a route:
 *
 * ```ts
 * @Controller("graphql")
 * export class GraphQLController extends BaseCrudGraphQLController {
 *   // Nest reads constructor-injection metadata off the concrete class, not
 *   // an inherited one — the subclass must declare this constructor (just
 *   // forwarding to `super`) even though it does nothing else.
 *   constructor(moduleRef: ModuleRef) {
 *     super(moduleRef);
 *   }
 *
 *   @Post()
 *   @HttpCode(200) // GraphQL-over-HTTP convention: 200 even for a mutation
 *   handle(@Body() body: { query: string; variables?: Record<string, unknown> }) {
 *     return this.execute(body.query, body.variables);
 *   }
 * }
 * ```
 *
 * An entity with no `registerCrudGraphQLTypes` call simply has no GraphQL
 * surface — opt-in per entity, same as the REST side is opt-in per
 * `@Crud` controller.
 */
export abstract class BaseCrudGraphQLController implements OnModuleInit {
  private schema!: GraphQLSchema;

  constructor(protected readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    this.schema = resolveCrudGraphQLSchema(getCrudEntities(), (entity) =>
      this.moduleRef.get(getCrudServiceToken(entity), { strict: false }),
    );
  }

  /** Runs one query/mutation against the merged schema — call this from the concrete controller's route. */
  protected execute(source: string, variableValues?: Record<string, unknown>): Promise<ExecutionResult> {
    return graphql({ schema: this.schema, source, variableValues });
  }
}
