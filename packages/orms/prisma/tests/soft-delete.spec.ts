import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AlreadyDeletedException,
  ConflictException,
  NotDeletedException,
  NotFoundException,
  type DefaultCrudService,
} from "@kavo/core";
import { buildEntityMetadata, createPrismaKavo } from "@kavo/prisma";
import { newTestPrismaClient } from "./support/client.js";

/** Soft delete over a marker column named through config. */
class Ticket {
  id!: number;
  reference!: string;
  title!: string;
  deletedAt!: Date | null;
}

/** Soft delete over an ordinary column, also named through config. */
class Invoice {
  id!: number;
  number!: string;
  archivedAt!: Date | null;
}

let client: PrismaClient;
let tickets: DefaultCrudService<Ticket>;
let invoices: DefaultCrudService<Invoice>;

beforeAll(() => {
  client = newTestPrismaClient();
  const kavo = createPrismaKavo(client as never, {
    datamodel: Prisma.dmmf.datamodel,
    entities: [Ticket, Invoice],
    caseInsensitiveFilters: false,
  });
  tickets = kavo.createCrud(Ticket, {
    softDelete: { field: "deletedAt" },
    operations: { purgeOne: true },
  }) as DefaultCrudService<Ticket>;
  invoices = kavo.createCrud(Invoice, {
    softDelete: { field: "archivedAt" },
  }) as DefaultCrudService<Invoice>;
});

afterAll(async () => {
  await client.$disconnect();
});

beforeEach(async () => {
  await client.ticket.deleteMany();
  await client.invoice.deleteMany();
});

async function newTicket(reference = "T-1"): Promise<number> {
  const created = await tickets.createOne({ reference, title: "broken login" } as never);
  return (created as Ticket).id;
}

describe("metadata seam — no auto-detected soft-delete column", () => {
  it("reports softDeleteField as null (Prisma has no @DeleteDateColumn equivalent)", () => {
    expect(buildEntityMetadata(Prisma.dmmf.datamodel, Ticket, new Map()).softDeleteField).toBeNull();
  });
});

describe("PrismaRepositoryAdapter — soft delete", () => {
  it("stamps the marker column and hides the row from every read", async () => {
    const id = await newTicket();
    await tickets.deleteOne(id);

    const raw = await client.ticket.findUnique({ where: { id } });
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
    expect(await client.ticket.count()).toBe(0);
  });

  it("still conflicts on a unique index held by a deleted row", async () => {
    const id = await newTicket("T-dup");
    await tickets.deleteOne(id);
    await expect(tickets.createOne({ reference: "T-dup", title: "again" } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("PrismaRepositoryAdapter — configured marker column", () => {
  it("soft-deletes, excludes, and restores over an ordinary column", async () => {
    const created = await invoices.createOne({ number: "INV-1" } as never);
    const id = (created as Invoice).id;

    await invoices.deleteOne(id);
    const raw = await client.invoice.findUnique({ where: { id } });
    expect(raw?.archivedAt).toBeInstanceOf(Date);
    expect((await invoices.findMany()).items).toHaveLength(0);
    expect((await invoices.findMany({ withDeleted: true })).items).toHaveLength(1);

    expect(await invoices.restoreOne(id)).toMatchObject({ id, archivedAt: null });
    expect((await invoices.findMany()).items).toHaveLength(1);
  });
});
