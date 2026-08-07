import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Schema } from "mongoose";
import type { DefaultKavoService } from "@kavo/core";
import { createMongooseKavo, toPlainDocument } from "@kavo/mongoose";
import { clearCollections, startTestDatabase, type TestDatabase } from "./support/database.js";

/**
 * End-to-end coverage for the document ↔ wire mapping: the shapes MongoDB
 * and Mongoose produce that are *not* plain JSON, and the schema options
 * that change what a write hands back. Each case here is a defect that
 * unit-testing the metadata seam alone did not catch, because the damage
 * only shows once a real document round-trips through the engine.
 */

interface Place {
  _id: string;
  name: string;
  address: { city: string; zip: string } | null;
}

interface Amount {
  _id: string;
  big: number;
  dec: number;
}

interface Renamed {
  _id: string;
  name: string;
}

function defineModels(connection: TestDatabase["connection"]) {
  // A schema whose `toObject` rewrites `_id` away — a very common Mongoose
  // idiom, and one that used to apply to `create` responses only.
  const renamedSchema = new Schema({ name: String });
  renamedSchema.set("toObject", {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret["id"] = ret["_id"];
      delete ret["_id"];
      return ret;
    },
  });

  return {
    // A *nested object literal*, not a sub-schema: Mongoose flattens this
    // into the paths `address.city` / `address.zip`.
    Place: connection.model("Place", new Schema({ name: String, address: { city: String, zip: String } })),
    Amount: connection.model("Amount", new Schema({ big: { type: BigInt }, dec: { type: Schema.Types.Decimal128 } })),
    Renamed: connection.model("Renamed", renamedSchema),
  };
}

let database: TestDatabase;
let models: ReturnType<typeof defineModels>;
let places: DefaultKavoService<Place>;
let amounts: DefaultKavoService<Amount>;
let renamed: DefaultKavoService<Renamed>;

beforeAll(async () => {
  database = await startTestDatabase();
  models = defineModels(database.connection);
  const kavo = createMongooseKavo(database.connection);
  places = kavo.createCrud(models.Place) as unknown as DefaultKavoService<Place>;
  amounts = kavo.createCrud(models.Amount) as unknown as DefaultKavoService<Amount>;
  renamed = kavo.createCrud(models.Renamed) as unknown as DefaultKavoService<Renamed>;
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await clearCollections(database.connection);
});

describe("nested object literals round-trip", () => {
  it("persists and returns a nested object declared as a plain literal", async () => {
    // Mongoose registers this as `address.city`/`address.zip`, neither of
    // which is a key of the document — so describing them verbatim made
    // the whole object vanish from writes and reads alike.
    const created = (await places.createOne({
      name: "Office",
      address: { city: "Paris", zip: "75001" },
    } as never)) as Place;
    expect(created.address).toEqual({ city: "Paris", zip: "75001" });

    const stored = (await models.Place.findById(created._id).lean()) as unknown as Place;
    expect(stored.address).toMatchObject({ city: "Paris", zip: "75001" });

    const fetched = (await places.findOne(created._id)) as Place;
    expect(fetched.address).toEqual({ city: "Paris", zip: "75001" });
    expect((await places.findMany()).items[0]).toMatchObject({ address: { city: "Paris" } });
  });

  it("patches a nested object as a whole value", async () => {
    const created = (await places.createOne({
      name: "Office",
      address: { city: "Paris", zip: "1" },
    } as never)) as Place;
    const patched = (await places.patchOne(created._id, { address: { city: "Lyon", zip: "2" } } as never)) as Place;
    expect(patched.address).toEqual({ city: "Lyon", zip: "2" });
  });
});

describe("arbitrary-precision numerics cross the wire as numbers", () => {
  it("returns BigInt and Decimal128 paths as JSON-serializable numbers", async () => {
    const created = (await amounts.createOne({ big: 42, dec: "1.50" } as never)) as Amount;

    // A hydrated document's `toObject()` yields a real `bigint`, which
    // `JSON.stringify` refuses outright — a 500 on every create.
    expect(typeof created.big).toBe("number");
    expect(created.big).toBe(42);
    // Decimal128 stays a BSON object that would serialize as
    // `{"$numberDecimal":"1.50"}`, contradicting its declared `number` kind.
    expect(typeof created.dec).toBe("number");
    expect(created.dec).toBe(1.5);
    expect(() => JSON.stringify(created)).not.toThrow();

    const fetched = (await amounts.findOne(created._id)) as Amount;
    expect(typeof fetched.big).toBe("number");
    expect(typeof fetched.dec).toBe("number");
    expect(() => JSON.stringify(fetched)).not.toThrow();
  });
});

describe("toPlainDocument decides what it recurses into", () => {
  // The two BSON shapes below never reach the engine through the models in
  // this file, so they are pinned against the exported helper directly.

  it("passes a Buffer through untouched instead of shredding it into an index map", () => {
    // `Object.entries(Buffer.from("x"))` is `[["0", 120]]`, so a recursion
    // that treated every object as plain would turn stored binary into
    // `{"0":120}` on every read. This adapter's contract is the id and
    // numeric conversion, not a BSON-wide codec.
    const blob = Buffer.from("x");
    const plain = toPlainDocument({ blob }) as { blob: unknown };
    expect(plain.blob).toBe(blob);
    expect(Buffer.isBuffer(plain.blob)).toBe(true);
  });

  it("recurses into a null-prototype object, which is what a lean document can be", () => {
    // This is the whole reason the plain-object test reads the prototype
    // rather than checking `constructor === Object`: under the stricter test
    // a lean document would pass straight through and its `_id` would leave
    // the adapter as a raw ObjectId.
    const source = Object.assign(Object.create(null) as Record<string, unknown>, {
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      a: 1,
    });
    expect(toPlainDocument(source)).toEqual({ _id: "507f1f77bcf86cd799439011", a: 1 });
  });
});

describe("schema toObject options do not reshape write responses", () => {
  it("returns _id from create even when the schema's toObject transform deletes it", async () => {
    // Reads are `lean`, so the transform never applies to them; if it
    // applied to `create`, POST would answer without the id of the
    // resource it just made while every GET still carried one.
    const created = (await renamed.createOne({ name: "Ada" } as never)) as Renamed;
    expect(created._id).toMatch(/^[0-9a-f]{24}$/);

    const fetched = (await renamed.findOne(created._id)) as Renamed;
    expect(fetched._id).toBe(created._id);
  });
});
