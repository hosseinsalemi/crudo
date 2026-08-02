import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Column, DataSource, DeleteDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";
import {
  AlreadyDeletedException,
  ConflictException,
  NotDeletedException,
  NotFoundException,
  type DefaultKavoService,
} from "@kavo/core";
import { buildEntityMetadata, createTypeOrmKavo } from "@kavo/typeorm";

/** Soft delete the ORM-declared way: one `@DeleteDateColumn`. */
@Entity()
class Ticket {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar", { unique: true })
  reference!: string;

  @Column("varchar")
  title!: string;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}

/** Soft delete over an ordinary column, named through config instead. */
@Entity()
class Invoice {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar")
  number!: string;

  @Column("datetime", { nullable: true })
  archivedAt!: Date | null;
}

let dataSource: DataSource;
let tickets: DefaultKavoService<Ticket>;
let invoices: DefaultKavoService<Invoice>;

beforeAll(async () => {
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [Ticket, Invoice],
    synchronize: true,
  });
  await dataSource.initialize();
  const kavo = createTypeOrmKavo(dataSource);
  tickets = kavo.createCrud(Ticket, {
    softDelete: { strategy: "soft" },
    operations: { purgeOne: true },
  }) as DefaultKavoService<Ticket>;
  invoices = kavo.createCrud(Invoice, {
    softDelete: { field: "archivedAt" },
  }) as DefaultKavoService<Invoice>;
});

afterAll(async () => {
  await dataSource.destroy();
});

beforeEach(async () => {
  await dataSource.getRepository(Ticket).clear();
  await dataSource.getRepository(Invoice).clear();
});

async function newTicket(reference = "T-1"): Promise<number> {
  const created = await tickets.createOne({ reference, title: "broken login" } as never);
  return (created as Ticket).id;
}

describe("@DeleteDateColumn detection", () => {
  it("surfaces the declared delete column on the metadata seam", () => {
    expect(buildEntityMetadata(dataSource, Ticket).softDeleteField).toBe("deletedAt");
    expect(buildEntityMetadata(dataSource, Invoice).softDeleteField).toBeNull();
  });
});

describe("TypeOrmRepositoryAdapter — soft delete", () => {
  it("stamps the marker column and hides the row from every read", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);

    const raw = await dataSource.getRepository(Ticket).findOne({ where: { id }, withDeleted: true });
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

  it("purges a deleted row for good, but never a live one", async () => {
    const id = await newTicket();
    await expect(tickets.purgeOne(id)).rejects.toBeInstanceOf(NotDeletedException);

    await tickets.deleteOne(id);
    await tickets.purgeOne(id);
    expect(await dataSource.getRepository(Ticket).count({ withDeleted: true } as never)).toBe(0);
  });

  it("still conflicts on a unique index held by a deleted row", async () => {
    // Documented adapter guidance: a soft-deleted row keeps its unique
    // index entries, and the fix is a partial index — not a Kavo rewrite.
    const id = await newTicket("T-dup");
    await tickets.deleteOne(id);
    await expect(tickets.createOne({ reference: "T-dup", title: "again" } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("TypeOrmRepositoryAdapter — configured marker column", () => {
  it("soft-deletes, excludes, and restores over an ordinary column", async () => {
    const created = await invoices.createOne({ number: "INV-1" } as never);
    const id = (created as Invoice).id;

    await invoices.deleteOne(id);
    const raw = await dataSource.getRepository(Invoice).findOneBy({ id });
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
