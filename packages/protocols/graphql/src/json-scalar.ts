import { GraphQLScalarType, Kind, valueFromASTUntyped } from "graphql";

/**
 * Arbitrary JSON, used for `filter` args until schema-derived
 * `<Entity>FilterInput` types exist (tracked separately — that's the
 * "derive types from entity metadata" work this package's proof-of-concept
 * status has always deferred). The value that reaches a resolver is the
 * raw filter AST (`FilterExpression` from `@kavo/core`) — the same shape
 * any other programmatic caller of `QueryContext.filter` already hands
 * core directly; there is no wire-string grammar to parse here.
 */
export const GraphQLJSON = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value — used here for a raw Kavo filter expression.",
  serialize: (value: unknown) => value,
  parseValue: (value: unknown) => value,
  parseLiteral: (ast) => (ast.kind === Kind.NULL ? null : valueFromASTUntyped(ast)),
});
