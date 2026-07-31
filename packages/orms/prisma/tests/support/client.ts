import { PrismaClient } from "@prisma/client";

/**
 * One shared SQLite file, pushed by `pnpm generate` (`prisma db push`)
 * against `prisma/schema.prisma` before the suite runs. `datasourceUrl` is
 * passed explicitly — bypassing `env("DATABASE_URL")` — because a plain
 * `vitest run` has no reason to have that variable set; the CLI commands
 * that build the schema (`generate`, `db push`) load it from
 * `prisma/.env` on their own.
 */
export function newTestPrismaClient(): PrismaClient {
  const url = new URL("../../prisma/dev.db", import.meta.url);
  return new PrismaClient({ datasourceUrl: `file:${url.pathname}` });
}
