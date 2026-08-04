import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0010, as assertions.
 *
 * The core barrel is an explicit named list: everything it names is public
 * API, everything else is internal, and the public surface changes only by
 * editing one reviewed file. Until now that was held up by review alone —
 * it appeared as a bullet in CLAUDE.md's Conventions, a line in
 * CONTRIBUTING.md, and a checklist item in `.claude/agents/kavo-reviewer.md`,
 * which is three copies of a rule and no gate.
 *
 * `export *` is the specific failure this forecloses, because it is the one
 * that changes the public surface as a *side effect* of an unrelated edit:
 * adding an internal export to a re-exported module silently ships it. The
 * other two ADR-0010 claims covered here — that the barrel is the only
 * documented entry point, and that deep imports are not API — are what
 * `no-deep-imports-through-a-barrel` enforces from the importing side.
 *
 * This file deliberately reads the barrel as text rather than importing it.
 * The subject under test is the *source spelling*, and `export *` is
 * invisible once the module is evaluated: a barrel that re-exported the world
 * would import identically to one that named 65 exports.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BARREL_PATH = resolve(REPO_ROOT, "packages/core/src/index.ts");

/**
 * Strip comments before matching. The barrel's own header comment contains
 * the string "export *" — it is the doc comment explaining that the file
 * does not use it — so a naive text search reports the rule's own
 * documentation as a violation of the rule.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

interface Manifest {
  readonly exports?: Record<string, unknown>;
}

describe("the @kavo/core barrel is an explicit named list (ADR-0010)", () => {
  const source = readFileSync(BARREL_PATH, "utf8");
  const code = stripComments(source);

  it("uses no `export *` — including the `as ns` and `type *` forms", () => {
    // Matches `export *`, `export * as ns`, and `export type * from` —
    // tolerating any whitespace between the keywords and the star, and
    // ignoring `export {}` / `export type {}`, the sanctioned spellings.
    //
    // `export type *` is the one that matters most here despite looking like
    // an edge case: this barrel is overwhelmingly `export type { ... }`, so
    // it is the form someone consolidating type re-exports reaches for first,
    // and it grows the public surface exactly the way ADR-0010 forecloses.
    const starExports = code.match(/^[ \t]*export[ \t]+(?:type[ \t]+)?\*/gm) ?? [];

    expect(
      starExports,
      "packages/core/src/index.ts must name every export explicitly (ADR-0010): `export *` " +
        "changes the public surface as a side effect of adding an unrelated internal export.",
    ).toEqual([]);
  });

  it("actually names exports, so the check above cannot pass vacuously", () => {
    // Guards the assertion itself: if the barrel were emptied or the strip
    // step over-matched and blanked the file, `export *` would trivially be
    // absent and the test above would go green on a broken barrel.
    const namedExports = code.match(/^[ \t]*export[ \t]+(type[ \t]+)?\{/gm) ?? [];

    expect(namedExports.length).toBeGreaterThan(20);
  });

  it("is the only entry point the package exposes — deep imports are not API", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/core/package.json"), "utf8")) as Manifest;

    // ADR-0010: "The `exports` map exposes only the barrel (deep imports are
    // not API)." This is the publishing-side half of the same decision that
    // `no-deep-imports-through-a-barrel` enforces on the importing side.
    expect(Object.keys(manifest.exports ?? {})).toEqual(["."]);
  });
});
