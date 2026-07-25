import { expectTypeOf } from "vitest";
import type { IncludePath } from "@crudo/core";
import { Author, Comment, Post } from "../support/blog-fixture.js";

/**
 * Type-level acceptance tests for spell-checked include paths (ADR-0008's
 * cap, applied to relations). See entity-input.test-d.ts for why these files
 * are `.test-d.ts` and how the `@ts-expect-error` directives are enforced.
 *
 * The blog fixture is `Author 1—* Post 1—* Comment` with a `Post.author`
 * back-edge, so a path can revisit a type and exercise the depth guard.
 */

// The whole depth-3 expansion, pinned. Scalars (`name`, `title`, `body`) are
// absent: `include` addresses relations, never fields.
expectTypeOf<IncludePath<Author>>().toEqualTypeOf<"posts" | "posts.author" | "posts.comments" | "posts.author.posts">();

// A leaf entity with no relations can include nothing at all.
expectTypeOf<IncludePath<Comment>>().toEqualTypeOf<never>();

const ok: readonly IncludePath<Author>[] = ["posts", "posts.comments", "posts.author.posts"];
void ok;

// To-many and to-one read the same: the array contributes no segment.
const toOne: IncludePath<Post> = "author";
const toMany: IncludePath<Post> = "comments";
void toOne;
void toMany;

// @ts-expect-error — a misspelled relation is a compile error. This is the
// behavior the old `readonly string[]` typing could not give.
const typo: IncludePath<Author> = "posts.commentz";
void typo;

// @ts-expect-error — scalar fields are not includable.
const scalar: IncludePath<Author> = "name";
void scalar;

// @ts-expect-error — depth 4 exceeds the default cap of 3.
const tooDeep: IncludePath<Author> = "posts.author.posts.comments";
void tooDeep;

// Raising the cap admits it — same knob as FieldPath, same hard maximum.
const deepened: IncludePath<Author, 5> = "posts.author.posts.comments";
void deepened;

// Untyped entities degrade to `string` rather than erroring: the runtime
// relation registry stays the real gate.
expectTypeOf<IncludePath<any>>().toEqualTypeOf<string>();
expectTypeOf<IncludePath<unknown>>().toEqualTypeOf<string>();

// An index-signature bag has unknowable keys — same degradation.
interface Bag {
  [key: string]: unknown;
}
expectTypeOf<IncludePath<Bag>>().toEqualTypeOf<string>();

// `QueryContext`'s default entity is `unknown`, so untyped callers keep the
// old `readonly string[]` contract exactly.
expectTypeOf<readonly IncludePath<unknown>[]>().toEqualTypeOf<readonly string[]>();
