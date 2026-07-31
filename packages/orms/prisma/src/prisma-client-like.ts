/**
 * The minimal structural shape this adapter needs from a generated Prisma
 * Client — one delegate per model, each with the handful of query methods
 * the adapter calls. Kept structural (not `import type { PrismaClient }
 * from "@prisma/client"`) so `@kavo/prisma`'s own build never needs a
 * generated client: `@prisma/client`'s package entrypoint only resolves
 * *after* `prisma generate` has run against the consumer's schema, and a
 * library package cannot assume that happened. A real generated
 * `PrismaClient` instance satisfies this structurally with no cast.
 */
export interface PrismaModelDelegate {
  findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** A Prisma Client instance, indexed by its per-model delegate property (`prisma.author`). */
export type PrismaClientLike = Record<string, PrismaModelDelegate>;

/** `Author` → `author`: Prisma's own delegate-naming rule (first letter lowercased). */
export function delegateName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}
