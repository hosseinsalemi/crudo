import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Embeddable, Embedded, Entity, Enum, MikroORM, PrimaryKey, Property } from "@mikro-orm/core";
import type { FieldMetadata } from "@kavo/core";
import { buildEntityMetadata } from "@kavo/mikroorm";
import { newTestOrm } from "./support/database.js";

enum Status {
  Active = "active",
  Banned = "banned",
}

@Entity()
class Widget {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  name!: string;

  @Property({ type: "number" })
  count!: number;

  @Property({ type: "boolean" })
  active!: boolean;

  @Property({ type: "Date" })
  releasedOn!: Date;

  @Property({ type: "json", nullable: true })
  payload: unknown = null;

  @Enum({ items: () => Status })
  status: Status = Status.Active;

  /** A column whose JavaScript representation is not its column type. */
  @Property({ columnType: "bigint", type: "bigint" })
  serial!: string;

  @Property({ type: "Date", onCreate: () => new Date() })
  createdAt!: Date;

  @Property({ type: "Date", onUpdate: () => new Date(), nullable: true })
  updatedAt: Date | null = null;

  @Property({ type: "number", version: true })
  version!: number;

  @Property({ type: "string", persist: false })
  computed!: string;
}

let orm: MikroORM;
let byName: Record<string, FieldMetadata>;

beforeAll(async () => {
  orm = await newTestOrm([Widget]);
  byName = Object.fromEntries(buildEntityMetadata(orm, Widget).fields.map((field) => [field.name, field]));
});

afterAll(async () => {
  await orm.close();
});

describe("buildEntityMetadata — field kinds", () => {
  it.each([
    ["name", "string"],
    ["count", "number"],
    ["active", "boolean"],
    ["releasedOn", "date"],
    ["payload", "json"],
    ["status", "enum"],
  ])("maps %s to the %s field kind", (field, kind) => {
    expect(byName[field]).toMatchObject({ kind });
  });

  it("follows the runtime representation, not the column type, for bigint", () => {
    // MikroORM hands a `bigint` column to JavaScript as a string to keep
    // precision, so `string` is what core must coerce toward — reading
    // `number` off the column type would corrupt values past 2^53.
    expect(byName["serial"]).toMatchObject({ kind: "string" });
  });

  it("falls back to the declared type when there is no JavaScript equivalent", () => {
    // `JsonType`'s `runtimeType` is `"any"`, which narrows nothing; the
    // declared type is the only thing left that says "json".
    expect(byName["payload"]).toMatchObject({ kind: "json" });
  });

  it("carries the enum's allowed values as the coercion allowlist", () => {
    expect(byName["status"]?.enumValues).toEqual(["active", "banned"]);
  });

  it("reports nullability from the property declaration", () => {
    expect(byName["payload"]).toMatchObject({ nullable: true });
    expect(byName["name"]).toMatchObject({ nullable: false });
  });
});

describe("buildEntityMetadata — generated properties", () => {
  it.each([
    ["id", "an auto-increment primary key"],
    ["createdAt", "an onCreate hook"],
    ["updatedAt", "an onUpdate hook"],
    ["version", "an optimistic-lock version"],
    ["computed", "a non-persisted property"],
  ])("marks %s generated (%s)", (field) => {
    expect(byName[field]).toMatchObject({ generated: true });
  });

  it.each(["name", "count", "status", "payload"])("leaves %s writable by the caller", (field) => {
    expect(byName[field]).toMatchObject({ generated: false });
  });
});

describe("buildEntityMetadata — embeddables", () => {
  it("exposes the embeddable property and drops its inner columns", async () => {
    @Embeddable()
    class Address {
      @Property({ type: "string" })
      city!: string;

      @Property({ type: "string" })
      street!: string;
    }

    @Entity()
    class Office {
      @PrimaryKey({ type: "number" })
      id!: number;

      @Embedded(() => Address, { object: true })
      address = new Address();

      @Embedded(() => Address, { object: false, prefix: "billing_" })
      billing = new Address();
    }

    const embedded = await newTestOrm([Office, Address]);
    try {
      const fields = buildEntityMetadata(embedded, Office).fields;
      // The addressable properties only — never MikroORM's internal child
      // names (`address~city`, `billing_city`), which would otherwise land in
      // derived DTOs and allowlists as unusable wire fields.
      expect(fields.map((field) => field.name)).toEqual(["id", "address", "billing"]);
      expect(fields.filter((field) => field.name !== "id")).toMatchObject([{ kind: "json" }, { kind: "json" }]);
    } finally {
      await embedded.close();
    }
  });
});

describe("buildEntityMetadata — refusals", () => {
  it("refuses a composite primary key", async () => {
    @Entity()
    class Membership {
      @PrimaryKey({ type: "number" })
      userId!: number;

      @PrimaryKey({ type: "number" })
      groupId!: number;

      @Property({ type: "string" })
      role!: string;
    }

    const composite = await newTestOrm([Membership]);
    try {
      expect(() => buildEntityMetadata(composite, Membership)).toThrowError(
        /requires exactly one primary key; found 2/,
      );
    } finally {
      await composite.close();
    }
  });
});
