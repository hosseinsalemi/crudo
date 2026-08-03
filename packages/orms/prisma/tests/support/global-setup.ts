import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where `tests/support/client.ts` puts the per-client SQLite copies it
 * provisions. Set here rather than fixed, so two vitest runs of this repo at
 * once cannot delete each other's databases; read from the environment
 * because workers are separate processes that inherit it at spawn time.
 */
export const SCRATCH_ROOT_ENV = "KAVO_PRISMA_SCRATCH_ROOT";

/**
 * One scratch root per vitest run, removed when the run ends.
 *
 * This is the counterpart to the per-client database copies (issue #101):
 * teardown has to happen here, in the main process, because vitest kills its
 * workers — a `process.on("exit")` handler inside one never runs, and the
 * copies would pile up in the OS temp directory instead.
 */
export default function setup(): () => void {
  const root = mkdtempSync(join(tmpdir(), "kavo-prisma-"));
  process.env[SCRATCH_ROOT_ENV] = root;

  return () => {
    delete process.env[SCRATCH_ROOT_ENV];
    rmSync(root, { recursive: true, force: true });
  };
}
