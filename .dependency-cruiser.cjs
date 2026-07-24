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
        "no node_modules — zero runtime dependencies (ADR-0005).",
      from: { path: "^packages/core" },
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
      from: { path: "^packages/orms/typeorm" },
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
      from: { path: "^packages/frameworks/nest" },
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
    exclude: { path: "\\.d\\.ts$|/dist/|/tests/" },
  },
};
