import type { OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { ExecutionResult, GraphQLSchema } from "graphql";
import { getCrudEntities } from "../crud.decorator.js";
import { getCrudServiceToken } from "../tokens.js";
import { loadGraphQL } from "./load-graphql.js";

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
 * `@kavo/graphql` and `graphql` are both loaded lazily, via `loadGraphQL()`
 * — not imported at the top of this file — so that `@kavo/nest`'s
 * always-loaded module graph never requires either to be installed. Only
 * `import type` appears above (erased at compile time, ADR-n/a but see
 * `load-graphql.ts`'s own doc comment for the full reasoning); the runtime
 * import happens the first time `onModuleInit`/`execute` actually runs,
 * which only happens for an app that opted in by extending this class or
 * setting `KavoModule`'s `graphql` option.
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

  async onModuleInit(): Promise<void> {
    const { resolveCrudGraphQLSchema } = await loadGraphQL();
    this.schema = resolveCrudGraphQLSchema(getCrudEntities(), (entity) =>
      this.moduleRef.get(getCrudServiceToken(entity), { strict: false }),
    );
  }

  /** Runs one query/mutation against the merged schema — call this from the concrete controller's route. */
  protected async execute(source: string, variableValues?: Record<string, unknown>): Promise<ExecutionResult> {
    const { graphql } = await loadGraphQL();
    return graphql({ schema: this.schema, source, variableValues });
  }
}
