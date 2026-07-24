/**
 * Mechanical enforcement of the package boundaries defined in
 * packages/docs/architecture/02-monorepo-and-packages.md.
 *
 * The rules here are the executable form of the dependency graph:
 *
 *   @crudo/nest ──▶ @crudo/core ◀── @crudo/typeorm
 *
 * `@crudo/core` imports nothing. Adapters and framework bindings import the
 * core barrel only — deep imports are not API. An illegal import fails CI
 * here, not in code review.
 */
module.exports = {
  forbidden: [
    {
      name: "core-imports-nothing",
      severity: "error",
      comment:
        "@crudo/core is the dependency-free hub: no other workspace package, " +
        "no node_modules — zero runtime dependencies (ADR-0005). Scoped to " +
        "`src`: core's own tests legitimately import the `@crudo/core` barrel " +
        "and vitest, and are governed by the `tests-*` rules below instead.",
      from: { path: "^packages/core/src" },
      to: {
        pathNot: "^packages/core",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "typeorm-only-imports-core",
      severity: "error",
      comment:
        "@crudo/typeorm may depend on @crudo/core and the typeorm peer — " +
        "never on @crudo/nest (ADR-0002). Both spellings are matched: a " +
        "workspace package specifier does not resolve to a path here, so a " +
        'path-only rule would miss `from "@crudo/nest"` — the spelling ' +
        "anyone would actually write.",
      from: { path: "^packages/orms/typeorm/src" },
      to: { path: "^(packages/frameworks|@crudo/nest)" },
    },
    {
      name: "nest-only-imports-core",
      severity: "error",
      comment:
        "@crudo/nest may depend on @crudo/core and the @nestjs/* peers — " +
        "never on an ORM adapter (ADR-0002). Adapters reach Nest's container " +
        "via DI, not via imports. Package-specifier form matched too, per the " +
        "note on typeorm-only-imports-core.",
      from: { path: "^packages/frameworks/nest/src" },
      to: { path: "^(packages/orms|@crudo/typeorm)" },
    },
    {
      name: "no-cross-package-deep-imports-core",
      severity: "error",
      comment:
        "Cross-package imports go through the package barrel (@crudo/core), " +
        "which is an explicit named list (ADR-0010). Deep imports into " +
        "another package's src are not API — matched as a relative path and " +
        "as a `@crudo/core/...` subpath. `packages/examples` is in scope: it " +
        "is the reference app, so an illegal import there teaches one.",
      from: { path: "^packages/(orms|frameworks|examples)" },
      to: { path: "^(packages/core/src/.+|@crudo/core/.+)" },
    },
    {
      name: "no-cross-package-deep-imports-adapters",
      severity: "error",
      comment: "Same rule for adapter/framework package internals.",
      from: { path: "^packages/core" },
      to: { path: "^packages/(orms|frameworks)/[^/]+/src/.+" },
    },
    {
      name: "tests-no-other-package-internals",
      severity: "error",
      comment:
        "A test file may import its own package's source and the @crudo/* " +
        "barrels — never another package's `src` or `tests`. Sharing a " +
        "fixture by reaching into a sibling package's tests is the same " +
        "boundary violation as doing it in production code (ADR-0002), and " +
        "until this rule existed it was the one edge nothing enforced: " +
        "`tests/` used to be excluded from cruising entirely. The `$1` " +
        "back-reference is the package root captured from `from`, so " +
        "same-package imports stay legal.",
      from: { path: "^(packages/core|packages/examples|packages/orms/[^/]+|packages/frameworks/[^/]+)/tests/" },
      to: {
        path: "^(packages/core|packages/examples|packages/orms/[^/]+|packages/frameworks/[^/]+)/(src|tests)/",
        pathNot: "^$1/",
      },
    },
    {
      name: "core-tests-know-no-adapter",
      severity: "error",
      comment:
        "Core's tests are held to core's own ignorance: the engine must be " +
        "testable with an in-memory fake and no ORM or framework anywhere " +
        "(ADR-0005, ADR-0001). `core-imports-nothing` is scoped to `src` so " +
        "core's tests may use the barrel and vitest; this keeps the part that " +
        "still matters — no adapter, no framework — enforced for them too.",
      from: { path: "^packages/core/tests" },
      to: { path: "^(@crudo/(typeorm|nest)|packages/(orms|frameworks))" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "No runtime import cycles. Type-only cycles are exempt: core's " +
        "contracts are mutually referential by design (e.g. CrudContext " +
        "references ResolvedEntityConfig and vice versa) and erase at " +
        "compile time.",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    exclude: { path: "\\.d\\.ts$|/dist/" },
  },
};
