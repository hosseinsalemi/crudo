import { expectTypeOf } from "vitest";
import { createKavo } from "@kavo/core";
import type { ComputedFieldDescriptor, KavoContext } from "@kavo/core";
import { Author } from "../support/blog-fixture.js";

/**
 * The type-level half of ADR-0019. `EntityConfig` grows an eighth
 * parameter, `Computed`, inferred from the keys of `computed` alone
 * (`allowlists` is a `NoInfer` position, so listing a real column there
 * cannot widen it). That is what lets an explicit `selectable` list name a
 * computed field without a cast, while `filterable`/`sortable` — which
 * stay typed to real entity paths — reject one outright.
 */

const kavo = createKavo();

// `resolve` is typed to the entity and to the request context, with no
// manual generic argument at the call site.
void kavo.createCrud(Author, {
  computed: {
    initials: {
      resolve: (author, context) => {
        expectTypeOf(author).toEqualTypeOf<Author>();
        expectTypeOf(context).toEqualTypeOf<KavoContext<Author>>();
        return author.name.slice(0, 2);
      },
    },
  },
});

// A declared computed name is usable in `selectable` alongside real paths.
void kavo.createCrud(Author, {
  computed: { initials: { resolve: (author) => author.name.slice(0, 2) } },
  allowlists: { selectable: ["id", "name", "initials"] },
});

// A descriptor can be declared standalone and still infer the key.
const initials: ComputedFieldDescriptor<Author> = {
  resolve: (author) => author.name.slice(0, 2),
};
void kavo.createCrud(Author, { computed: { initials }, allowlists: { selectable: ["id", "initials"] } });

void kavo.createCrud(Author, {
  computed: {
    // @ts-expect-error — `resolve` is typed to the entity, so a misspelled
    // property is caught here rather than as `undefined` in a response.
    initials: { resolve: (author) => author.nmae },
  },
});

void kavo.createCrud(Author, {
  computed: { initials: { resolve: (author) => author.name } },
  // @ts-expect-error — the `{ exclude }` form is barred from filterable too:
  // excluding a name that could never be in the list is a confusion, not a
  // no-op worth silently accepting.
  allowlists: { filterable: { exclude: ["initials"] } },
});

// `{ exclude }` on `selectable` accepts a computed name, because that list
// really does contain one to remove.
void kavo.createCrud(Author, {
  computed: { initials: { resolve: (author) => author.name } },
  allowlists: { selectable: { exclude: ["initials"] } },
});

void kavo.createCrud(Author, {
  computed: { initials: { resolve: (author) => author.name } },
  // @ts-expect-error — a computed field can never be filterable: no column.
  allowlists: { filterable: ["initials"] },
});

void kavo.createCrud(Author, {
  computed: { initials: { resolve: (author) => author.name } },
  // @ts-expect-error — nor sortable, for the same reason.
  allowlists: { sortable: ["initials"] },
});

void kavo.createCrud(Author, {
  computed: { initials: { resolve: (author) => author.name } },
  // @ts-expect-error — `selectable` still spell-checks real entity paths.
  allowlists: { selectable: ["nmae"] },
});

// @ts-expect-error — and a name no `computed` entry declares stays rejected.
void kavo.createCrud(Author, { allowlists: { selectable: ["initials"] } });

// @ts-expect-error — a descriptor without `resolve` is not a descriptor.
void kavo.createCrud(Author, { computed: { initials: { selectable: true } } });
