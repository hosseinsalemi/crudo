import mongoose, { Schema } from "mongoose";

/**
 * The Mongoose half of the reference app: a small Blog domain
 * (`Author` ← `Article`) that exercises the document-store paths the Pet
 * domain cannot — string `_id`s, a `ref` edge loaded by `populate`, a
 * scalar array, and config-declared soft delete.
 *
 * There is nothing to declare twice here. A Mongoose model is already a
 * constructor, so it *is* the entity identity `@Kavo`/`createCrud` want
 * (ADR-0018) — no marker classes, no entity list, and no mirror of the
 * schema anywhere. The models are created at module scope, before any
 * connection exists, which is exactly what lets `@Kavo(Article)` run at
 * class-decoration time (ADR-0012); Mongoose buffers commands until
 * `mongoose.connect(...)` resolves.
 */

export const AUTHOR_MODEL = "Author";
export const ARTICLE_MODEL = "Article";

export const ArticleStatus = {
  Draft: "draft",
  Published: "published",
} as const;

const authorSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

const articleSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: "" },
    status: { type: String, enum: Object.values(ArticleStatus), default: ArticleStatus.Draft },
    // A scalar array — a column, not a relation (core's `ScalarKeys`).
    tags: [String],
    // The `ref` edge. In Mongoose this single path is *both* the relation
    // and the foreign key, so `author` is includable (`?include=author`)
    // and writable by id (`{"author": "<id>"}` — ADR-0014).
    author: { type: Schema.Types.ObjectId, ref: AUTHOR_MODEL },
    // Mongoose declares no `@DeleteDateColumn` equivalent, so the marker is
    // an ordinary path that the controller names via `softDelete.field`.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Author = mongoose.model(AUTHOR_MODEL, authorSchema);
export const Article = mongoose.model(ARTICLE_MODEL, articleSchema);
