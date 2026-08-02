import mongoose, { Schema } from "mongoose";

/**
 * The relation side of the Blog domain.
 *
 * There is nothing to declare twice here. A Mongoose model is already a
 * constructor, so it *is* the entity identity `@Kavo`/`createCrud` want
 * (ADR-0018) — no marker classes, no entity list, and no mirror of the
 * schema anywhere.
 *
 * The model is created at module scope, before any connection exists,
 * which is exactly what lets `@Kavo(Author)` run at class-decoration time
 * (ADR-0012); Mongoose buffers commands until `mongoose.connect(...)`
 * resolves.
 */
export const AUTHOR_MODEL = "Author";

const authorSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

export const Author = mongoose.model(AUTHOR_MODEL, authorSchema);
