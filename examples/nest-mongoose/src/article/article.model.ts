import mongoose, { Schema } from "mongoose";
import { AUTHOR_MODEL } from "../author/author.model.js";

/**
 * The owning side of the Blog domain — the model that exercises the
 * document-store paths the Pet example cannot: a `ref` edge loaded by
 * `populate`, a scalar array, string `_id`s, and config-declared soft
 * delete.
 *
 * Like `Author`, it is created at module scope, before any connection
 * exists, which is exactly what lets `@Kavo(Article)` run at
 * class-decoration time (ADR-0012); Mongoose buffers commands until
 * `mongoose.connect(...)` resolves. The model itself is the entity
 * identity (ADR-0018) — nothing here is declared twice.
 */
export const ARTICLE_MODEL = "Article";

export const ArticleStatus = {
  Draft: "draft",
  Published: "published",
} as const;

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

export const Article = mongoose.model(ARTICLE_MODEL, articleSchema);
