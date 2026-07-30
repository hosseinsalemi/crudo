import { describe, expect, it } from "vitest";
import { parse, valueFromASTUntyped, type ValueNode } from "graphql";
import { GraphQLJSON } from "@kavo/graphql";

/** Parses a GraphQL value literal (the part after `filter:`) the same way the executor would when calling `parseLiteral`. */
function literalOf(source: string): ValueNode {
  const document = parse(`{ f(x: ${source}) }`);
  const field = document.definitions[0] as {
    selectionSet: { selections: readonly { arguments: readonly { value: ValueNode }[] }[] };
  };
  return field.selectionSet.selections[0]!.arguments[0]!.value;
}

describe("GraphQLJSON", () => {
  it("serializes and parses values pass-through", () => {
    const value = { kind: "condition", field: "age", operator: "GTE", value: 18 };
    expect(GraphQLJSON.serialize(value)).toBe(value);
    expect(GraphQLJSON.parseValue!(value)).toBe(value);
  });

  it("parses a null literal as null, not the string 'null'", () => {
    expect(GraphQLJSON.parseLiteral!(literalOf("null"), {})).toBeNull();
  });

  it("parses object/list literals into the equivalent plain JS value", () => {
    const parsed = GraphQLJSON.parseLiteral!(
      literalOf(
        `{ kind: "group", operator: "AND", children: [{ kind: "condition", field: "done", operator: "EQ", value: true }] }`,
      ),
      {},
    );
    expect(parsed).toEqual({
      kind: "group",
      operator: "AND",
      children: [{ kind: "condition", field: "done", operator: "EQ", value: true }],
    });
  });

  it("round-trips through valueFromASTUntyped for a scalar literal", () => {
    expect(GraphQLJSON.parseLiteral!(literalOf("42"), {})).toBe(valueFromASTUntyped(literalOf("42")));
  });

  it("is registered under the name JSON", () => {
    expect(GraphQLJSON.name).toBe("JSON");
  });
});
