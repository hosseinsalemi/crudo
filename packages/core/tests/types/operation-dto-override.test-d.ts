import { expectTypeOf } from "vitest";
import { createKavo } from "@kavo/core";
import type { EntityInput, ListResultDto } from "@kavo/core";
import { Author } from "../support/blog-fixture.js";

/**
 * Per-operation DTO override (issue #131): `operations.<id>.dto.<field>`
 * narrows one operation's request body, response, or query independently
 * of the entity's root `dto` slot and of every other operation.
 */

class CreateAuthorRequestDto {
  name = "";
}

class AuthorCreatedDto {
  id = 0;
}

class AuthorProfileDto {
  id = 0;
  name = "";
  bio = "";
}

class AuthorSearchQueryDto {
  q?: string;
}

class AuthorListItemDto {
  id = 0;
}

const kavo = createKavo();

const authors = kavo.createCrud(Author, {
  operations: {
    createOne: { dto: { input: CreateAuthorRequestDto, output: AuthorCreatedDto } },
    findOne: { dto: { output: AuthorProfileDto, query: AuthorSearchQueryDto } },
    findMany: { dto: { output: AuthorListItemDto, query: AuthorSearchQueryDto } },
  },
});

// `createOne`'s request body and response follow its own override, not the
// entity-derived default (`EntityInput<Author>` / `Author`).
expectTypeOf(authors.createOne).parameter(0).toEqualTypeOf<CreateAuthorRequestDto>();
expectTypeOf(authors.createOne).returns.resolves.toEqualTypeOf<AuthorCreatedDto>();

// `findOne`'s response and query follow its own override — a *different*
// shape from createOne's, on the same entity.
expectTypeOf(authors.findOne).parameter(1).toEqualTypeOf<AuthorSearchQueryDto | undefined>();
expectTypeOf(authors.findOne).returns.resolves.toEqualTypeOf<AuthorProfileDto>();
expectTypeOf(authors.findOne).returns.resolves.not.toEqualTypeOf<AuthorCreatedDto>();

// `findMany`'s element type and query follow its own override too — the
// list envelope still wraps it in `ListResultDto`.
expectTypeOf(authors.findMany).parameter(0).toEqualTypeOf<AuthorSearchQueryDto | undefined>();
expectTypeOf(authors.findMany).returns.resolves.toEqualTypeOf<ListResultDto<AuthorListItemDto>>();

// An operation that declares no override keeps the entity-wide default —
// `updateOne` was never mentioned, so it stays `EntityInput<Author>` in and
// `Author` out.
expectTypeOf(authors.updateOne).parameter(1).toEqualTypeOf<EntityInput<Author>>();
expectTypeOf(authors.updateOne).returns.resolves.toEqualTypeOf<Author>();

// `deleteOne`/`purgeOne` have no `dto` position at all — the override
// shape is unrepresentable, not just unused.
kavo.createCrud(Author, {
  // @ts-expect-error — `deleteOne` is a void result with no query; it has no `dto` key to set.
  operations: { deleteOne: { dto: { output: AuthorProfileDto } } },
});
kavo.createCrud(Author, {
  // @ts-expect-error — `createOne` has no `query` position.
  operations: { createOne: { dto: { query: AuthorSearchQueryDto } } },
});
kavo.createCrud(Author, {
  // @ts-expect-error — `findOne` has no `input` position (no request body).
  operations: { findOne: { dto: { input: CreateAuthorRequestDto } } },
});

// `restoreOne` narrows independently too, reusing the `item` slot's
// *position* but not necessarily its type.
const restorable = kavo.createCrud(Author, {
  operations: { restoreOne: { dto: { output: AuthorProfileDto } } },
});
expectTypeOf(restorable.restoreOne).returns.resolves.toEqualTypeOf<AuthorProfileDto>();
