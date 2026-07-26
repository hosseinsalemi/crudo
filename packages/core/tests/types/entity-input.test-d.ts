import { expectTypeOf } from "vitest";
import type { EntityInput, ScalarKeys } from "@kavo/core";

/**
 * Type-level acceptance tests for the write-shape default.
 *
 * These files end in `.test-d.ts`, not `.spec.ts`: vitest's `include` only
 * collects `*.spec.ts`, so nothing here runs. The assertions are checked by
 * `pnpm typecheck` (`tsconfig.tests.json`) — `expectTypeOf` erases at
 * runtime and every `@ts-expect-error` is a real, enforced expectation:
 * if a change made the bad call legal, the unused directive itself errors.
 */

class Widget {
  id = 0;
  label = "";
  price: number | null = null;
  releasedAt: Date = new Date(0);
  tags: string[] = [];
  reviews: { rating: number }[] = [];
  owner: { id: number } | null = null;
  describe(): string {
    return this.label;
  }
}

// `Date` counts as a scalar (it is in `Primitive`); a primitive-element array
// (`tags`, a TypeORM `simple-array` column) counts as scalar too — it is a
// column, not a relation. An object-element array (`reviews`, a to-many
// relation shape), a nested object, and methods do not.
expectTypeOf<ScalarKeys<Widget>>().toEqualTypeOf<"id" | "label" | "price" | "releasedAt" | "tags">();

// Every key optional: the zero-config write path must accept a partial body
// without demanding generated columns. This is the call that failed before.
const partial: EntityInput<Widget> = { label: "x" };
const empty: EntityInput<Widget> = {};
const full: EntityInput<Widget> = { id: 1, label: "x", price: 2, releasedAt: new Date(0) };
void partial;
void empty;
void full;

// A nullable scalar accepts both arms.
const nulled: EntityInput<Widget> = { price: null };
void nulled;

// @ts-expect-error — unknown keys are still rejected; loosening is not "anything goes".
const unknownKey: EntityInput<Widget> = { nope: 1 };
void unknownKey;

// @ts-expect-error — relation objects are never a valid write body (ADR-0014: associate by id).
const relationKey: EntityInput<Widget> = { owner: { id: 1 } };
void relationKey;

// A primitive-element array is a writable scalar column, not a relation.
const arrayKey: EntityInput<Widget> = { tags: ["a"] };
void arrayKey;

// @ts-expect-error — an object-element array is a to-many relation, and
// relations are associated by id, never written inline (ADR-0014).
const relationArrayKey: EntityInput<Widget> = { reviews: [{ rating: 5 }] };
void relationArrayKey;

// @ts-expect-error — methods are not part of the write shape.
const methodKey: EntityInput<Widget> = { describe: () => "x" };
void methodKey;

// @ts-expect-error — a scalar key still has to hold the right type.
const wrongType: EntityInput<Widget> = { label: 1 };
void wrongType;
