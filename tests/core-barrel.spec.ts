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
 *
 * **Line comments come out first, and the order is load-bearing.** Stripping
 * block comments first lets a line comment that contains an unterminated
 * `/*` open a block the regex then closes at the next `*` + `/` anywhere
 * below, swallowing every real export in between — including an `export *`.
 * That is not a contrived bypass: a comment mentioning a glob or a file
 * pattern is enough, and the resulting file is clean under `tsc`, `prettier`
 * and `oxlint`, so nothing else in the gate would catch it either. Removing
 * line comments first means such a `/*` is gone before it can open anything.
 */
function stripComments(source: string): string {
  return source.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

interface Manifest {
  readonly exports?: Record<string, unknown>;
}

describe("the @kavo/core barrel is an explicit named list (ADR-0010)", () => {
  const source = readFileSync(BARREL_PATH, "utf8");
  const code = stripComments(source);

  it("uses no `export *` — including the `as ns` and `type *` forms", () => {
    // Matches `export *`, `export * as ns`, and `export type * from` —
    // ignoring `export {}` / `export type {}`, the sanctioned spellings.
    //
    // `export type *` is the one that matters most here despite looking like
    // an edge case: this barrel is overwhelmingly `export type { ... }`, so
    // it is the form someone consolidating type re-exports reaches for first,
    // and it grows the public surface exactly the way ADR-0010 forecloses.
    //
    // Deliberately not `^`-anchored, and `\s` rather than `[ \t]`: a
    // line-anchored pattern misses `export {a}; export * from "./b.js"` and
    // `export\n  * from "./b.js"`, and a tab-or-space class misses a
    // non-breaking space. Prettier would normalize all three — but
    // `format:check` is a separate CI job from `pnpm check`, so relying on it
    // would leave this spec's guarantee borrowed from a gate that does not
    // run beside it. The comment strip above is what keeps the loose pattern
    // from matching the header's own prose.
    const starExports = code.match(/\bexport\s+(?:type\s+)?\*/g) ?? [];

    expect(
      starExports,
      "packages/core/src/index.ts must name every export explicitly (ADR-0010): `export *` " +
        "changes the public surface as a side effect of adding an unrelated internal export.",
    ).toEqual([]);
  });

  it("actually names exports, so the check above cannot pass vacuously", () => {
    // Guards the assertion itself. Two ways the check above could go green on
    // a barrel it should have failed, and this covers both:
    //
    //   1. the barrel is emptied or blanked outright — no `export *` left to
    //      find because nothing is left at all;
    //   2. `stripComments` over-matches and eats *part* of the file, taking a
    //      real `export *` with it while leaving enough behind to look alive.
    //
    // Comparing the stripped count against the raw count catches (2), which a
    // fixed threshold cannot: an over-strip that removes a star export
    // usually removes named exports either side of it, and any drop at all is
    // a signal the strip reached past a comment. Requiring a non-zero count
    // catches (1). Neither needs updating as the barrel grows — a magic
    // number here would have to be a low bar to stay true, and a low bar is
    // one a 60%-emptied barrel still clears.
    const NAMED_EXPORT = /^[ \t]*export[ \t]+(?:type[ \t]+)?\{/gm;
    const inStripped = code.match(NAMED_EXPORT) ?? [];
    const inSource = source.match(NAMED_EXPORT) ?? [];

    expect(inStripped.length, "the barrel names no exports at all — it is empty or was blanked").toBeGreaterThan(0);
    expect(
      inStripped.length,
      "stripComments removed a real `export { ... }`, so it reached past a comment boundary — " +
        "the `export *` check above cannot be trusted on this file.",
    ).toBe(inSource.length);
  });

  it("is the only entry point the package exposes — deep imports are not API", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/core/package.json"), "utf8")) as Manifest;

    // ADR-0010: "The `exports` map exposes only the barrel (deep imports are
    // not API)." This is the publishing-side half of the same decision that
    // `no-deep-imports-through-a-barrel` enforces on the importing side.
    expect(Object.keys(manifest.exports ?? {})).toEqual(["."]);
  });
});
