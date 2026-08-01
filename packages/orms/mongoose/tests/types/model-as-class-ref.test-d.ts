import mongoose, { Schema } from "mongoose";
import { expectTypeOf } from "vitest";
import type { ClassRef } from "@kavo/core";
import { createMongooseInfrastructure, createMongooseKavo } from "@kavo/mongoose";

/**
 * Type-level acceptance tests for the decision at the heart of this
 * adapter (ADR-0018): **a Mongoose model is already core's `ClassRef`**, so
 * `@kavo/mongoose` needs no marker classes and no `entities` list the way
 * `@kavo/prisma` does (ADR-0017).
 *
 * That claim is a *type* claim — `ClassRef<T> = abstract new (...args:
 * never[]) => T` — and a runtime test cannot fail when it stops holding. If
 * a future Mongoose release drops the construct signature from `Model`,
 * these assertions break the build, which is exactly the alarm that should
 * ring: the ADR's premise would be gone.
 *
 * Compile-only (`.test-d.ts`), so vitest never collects it and no database
 * is involved — `tsc` alone checks it via `tsconfig.tests.json`.
 */

const UserSchema = new Schema({
  email: { type: String, required: true },
  age: Number,
});

const User = mongoose.model("User", UserSchema);

// The load-bearing assertion: the model satisfies ClassRef with no cast,
// no marker class, and no `as never`.
expectTypeOf(User).toExtend<ClassRef>();

// …and therefore flows straight into the composition root.
const kavo = createMongooseKavo(mongoose.connection);
kavo.createCrud(User);

// A standalone Mongoose instance and a dedicated connection are both valid
// registries — `models` is all the seam asks for.
createMongooseInfrastructure(mongoose);
createMongooseInfrastructure(mongoose.connection);
createMongooseInfrastructure(new mongoose.Mongoose());

// An ordinary class is still a ClassRef, but it is not a Mongoose model —
// that mistake is caught at runtime by `asModel`, with an error naming the
// entity, because no type-level check can distinguish the two here.
class NotAModel {}
expectTypeOf(NotAModel).toExtend<ClassRef>();

// The registry argument is not optional: an adapter with no way to resolve
// a relation's `ref` would fail lazily instead of at the call site.
// @ts-expect-error - a connection (or Mongoose instance) is required
createMongooseInfrastructure();

// A plain object is not a model registry.
// @ts-expect-error - `models` is missing
createMongooseInfrastructure({});
