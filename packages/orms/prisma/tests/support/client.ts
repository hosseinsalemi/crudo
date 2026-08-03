import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SCRATCH_ROOT_ENV } from "./global-setup.js";

/**
 * The SQLite file `pnpm generate` (`prisma db push`) builds from
 * `prisma/schema.prisma`. No test ever opens it: it is a *template*, copied
 * per client, which is what keeps the spec files from sharing one database.
 */
const TEMPLATE_DATABASE = fileURLToPath(new URL("../../prisma/template.db", import.meta.url));

/**
 * SQLite spreads one database over up to three files. A finished `db push`
 * leaves a checkpointed, journal-free database behind, but copy whatever
 * sidecars do exist so a copy can never be a torn read of the template.
 */
const DATABASE_FILE_SUFFIXES = ["", "-journal", "-wal", "-shm"];

/**
 * Copies the template database to a fresh directory under this run's scratch
 * root (`tests/support/global-setup.ts`, which also removes it afterwards) and
 * returns the copy's path. Exported for its own error path; specs want
 * {@link newTestPrismaClient}.
 */
export function provisionTestDatabase(templatePath: string = TEMPLATE_DATABASE): string {
  if (!existsSync(templatePath)) {
    throw new Error(`No Prisma test-fixture database at ${templatePath} — run \`pnpm generate\` first.`);
  }
  const directory = mkdtempSync(join(process.env[SCRATCH_ROOT_ENV] ?? tmpdir(), "db-"));
  const databasePath = join(directory, basename(templatePath));
  for (const suffix of DATABASE_FILE_SUFFIXES) {
    if (existsSync(`${templatePath}${suffix}`)) copyFileSync(`${templatePath}${suffix}`, `${databasePath}${suffix}`);
  }
  return databasePath;
}

/**
 * A Prisma Client bound to a database file of its own.
 *
 * Vitest runs spec files in parallel workers and SQLite admits one writer at a
 * time, so pointing every spec at one file made the suite a lottery on a
 * loaded CI runner: a `beforeEach` write chain in one file could hold the file
 * lock long enough for another file's query to die with `P1008` (issue #101).
 * Copying the template per client removes the contended resource rather than
 * widening the timeout around it, so the specs still run in parallel.
 *
 * `datasourceUrl` is passed explicitly — bypassing `env("DATABASE_URL")` —
 * because a plain `vitest run` has no reason to have that variable set; the
 * CLI commands that build the template (`generate`, `db push`) load it from
 * `prisma/.env` on their own.
 */
export function newTestPrismaClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: `file:${provisionTestDatabase()}` });
}
