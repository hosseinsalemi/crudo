import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Entity, MikroORM, PrimaryKey, Property } from "@mikro-orm/core";
import {
  AlreadyDeletedException,
  ConflictException,
  NotDeletedException,
  NotFoundException,
  type DefaultKavoService,
} from "@kavo/core";
import { buildEntityMetadata, createMikroOrmKavo } from "@kavo/mikroorm";
import { clearDatabase, newTestOrm } from "./support/database.js";

/**
 * Soft delete over an ordinary nullable column. Unlike `@kavo/typeorm` there
 * is only one shape to test: MikroORM declares no delete-date column of its
 * own, so the marker is always an ordinary property and the strategy is
 * always named in Kavo config.
 */
@Entity()
class Ticket {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string", unique: true })
  reference!: string;

  @Property({ type: "string" })
  title!: string;

  @Property({ type: "Date", nullable: true })
  deletedAt: Date | null = null;
}

@Entity()
class Invoice {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "string" })
  number!: string;

  @Property({ type: "Date", nullable: true })
  archivedAt: Date | null = null;
}

let orm: MikroORM;
let tickets: DefaultKavoService<Ticket>;
let invoices: DefaultKavoService<Invoice>;

beforeAll(async () => {
  orm = await newTestOrm([Ticket, Invoice]);
  const kavo = createMikroOrmKavo(orm);
  tickets = kavo.createCrud(Ticket, {
    softDelete: { strategy: "soft", field: "deletedAt" },
    operations: { purgeOne: true },
  }) as DefaultKavoService<Ticket>;
  invoices = kavo.createCrud(Invoice, {
    softDelete: { strategy: "soft", field: "archivedAt" },
  }) as DefaultKavoService<Invoice>;
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  await clearDatabase(orm);
});

async function newTicket(reference = "T-1"): Promise<number> {
  const created = await tickets.createOne({ reference, title: "broken login" } as never);
  return (created as Ticket).id;
}

describe("delete-marker detection", () => {
  it("reports no ORM-declared delete column, because MikroORM declares none", () => {
    // MikroORM's soft-delete pattern is a user-defined `@Filter`, a query
    // concern rather than a column declaration — so there is nothing for the
    // metadata seam to detect and `softDelete.field` must be configured.
    expect(buildEntityMetadata(orm, Ticket).softDeleteField).toBeNull();
    expect(buildEntityMetadata(orm, Invoice).softDeleteField).toBeNull();
  });
});

describe("MikroOrmRepositoryAdapter — soft delete", () => {
  it("stamps the marker column and hides the row from every read", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);

    const raw = await orm.em.fork().findOne(Ticket, { id });
    expect(raw?.deletedAt).toBeInstanceOf(Date);

    await expect(tickets.findOne(id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await tickets.findMany()).items).toHaveLength(0);
    expect((await tickets.findMany()).total).toBe(0);
  });

  it("returns deleted rows under withDeleted", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);

    const list = await tickets.findMany({ withDeleted: true });
    expect(list.items).toHaveLength(1);
    expect(list.total).toBe(1);
    expect(await tickets.findOne(id, { withDeleted: true } as never)).toMatchObject({ id });
  });

  it("shows only deleted rows under onlyDeleted, live rows excluded", async () => {
    const deletedId = await newTicket("T-deleted");
    await newTicket("T-live");
    await tickets.deleteOne(deletedId);

    const list = await tickets.findMany({ onlyDeleted: true });
    expect(list.items).toMatchObject([{ id: deletedId }]);
    expect(list.total).toBe(1);
    expect(await tickets.findOne(deletedId, { onlyDeleted: true } as never)).toMatchObject({ id: deletedId });
  });

  it("keeps the soft-delete scope alongside a filter rather than replacing it", async () => {
    const deletedId = await newTicket("T-deleted");
    await newTicket("T-live");
    await tickets.deleteOne(deletedId);

    // Both predicates must survive the AND: a filter that matches the deleted
    // row must still not return it.
    const list = await tickets.findMany({
      filter: { kind: "condition", field: "reference", operator: "LIKE", value: "T-%" },
    });
    expect(list.items).toMatchObject([{ reference: "T-live" }]);
  });

  it("rejects withDeleted and onlyDeleted set together", async () => {
    await expect(tickets.findMany({ withDeleted: true, onlyDeleted: true })).rejects.toMatchObject({
      issues: [{ field: "onlyDeleted", code: "KAVO_QUERY_CONFLICTING_PARAMS" }],
    });
  });

  it("keeps updates away from deleted rows", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);
    await expect(tickets.patchOne(id, { title: "resurrected" } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a second delete with 409 already-deleted", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);
    await expect(tickets.deleteOne(id)).rejects.toBeInstanceOf(AlreadyDeletedException);
  });

  it("restores a deleted row and refuses to restore a live one", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);

    const restored = await tickets.restoreOne(id);
    expect(restored).toMatchObject({ id, deletedAt: null });
    expect((await tickets.findMany()).items).toHaveLength(1);
    await expect(tickets.restoreOne(id)).rejects.toBeInstanceOf(NotDeletedException);
  });

  it("throws NotFound restoring a row that never existed", async () => {
    await expect(tickets.restoreOne(4242)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("purges a deleted row for good, but never a live one", async () => {
    const id = await newTicket();
    await expect(tickets.purgeOne(id)).rejects.toBeInstanceOf(NotDeletedException);

    await tickets.deleteOne(id);
    await tickets.purgeOne(id);
    expect(await orm.em.fork().count(Ticket, {})).toBe(0);
  });

  it("still conflicts on a unique index held by a deleted row", async () => {
    // Documented adapter guidance: a soft-deleted row keeps its unique index
    // entries, and the fix is a partial index — not a Kavo rewrite.
    const id = await newTicket("T-dup");
    await tickets.deleteOne(id);
    await expect(tickets.createOne({ reference: "T-dup", title: "again" } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("MikroOrmRepositoryAdapter — a differently named marker column", () => {
  it("soft-deletes, excludes, and restores over an ordinary column", async () => {
    const created = await invoices.createOne({ number: "INV-1" } as never);
    const id = (created as Invoice).id;

    await invoices.deleteOne(id);
    const raw = await orm.em.fork().findOne(Invoice, { id });
    expect(raw?.archivedAt).toBeInstanceOf(Date);
    expect((await invoices.findMany()).items).toHaveLength(0);
    expect((await invoices.findMany({ withDeleted: true })).items).toHaveLength(1);

    expect(await invoices.restoreOne(id)).toMatchObject({ id, archivedAt: null });
    expect((await invoices.findMany()).items).toHaveLength(1);
  });

  it("shows only deleted rows under onlyDeleted over an ordinary column", async () => {
    const deleted = await invoices.createOne({ number: "INV-deleted" } as never);
    await invoices.createOne({ number: "INV-live" } as never);
    const deletedId = (deleted as Invoice).id;
    await invoices.deleteOne(deletedId);

    const list = await invoices.findMany({ onlyDeleted: true });
    expect(list.items).toMatchObject([{ id: deletedId }]);
  });
});

describe("MikroOrmRepositoryAdapter — hard delete", () => {
  it("removes the row outright and refuses a missing one", async () => {
    const kavo = createMikroOrmKavo(orm);
    const hard = kavo.createCrud(Invoice, {
      softDelete: { strategy: "hard" },
    }) as DefaultKavoService<Invoice>;

    const created = (await hard.createOne({ number: "INV-hard" } as never)) as Invoice;
    await hard.deleteOne(created.id);
    expect(await orm.em.fork().count(Invoice, {})).toBe(0);
    // `nativeDelete` reports zero affected rows for a row that is already
    // gone, which is what turns a repeat delete into a 404 rather than a
    // silent success.
    await expect(hard.deleteOne(created.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses to enable restoreOne on a hard-delete entity at bootstrap", () => {
    // Core catches this at `createCrud` rather than leaving the adapter to
    // fail per request — the adapter's own `requireSoftDelete` guard is the
    // second line, for a hand-built context.
    expect(() =>
      createMikroOrmKavo(orm).createCrud(Invoice, {
        softDelete: { strategy: "hard" },
        operations: { restoreOne: true },
      }),
    ).toThrowError(/hard delete strategy/);
  });
});
