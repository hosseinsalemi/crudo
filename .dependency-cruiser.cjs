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
        "never on @crudo/nest.",
      from: { path: "^packages/orms/typeorm" },
      to: { path: "^packages/frameworks" },
    },
    {
      name: "nest-only-imports-core",
      severity: "error",
      comment:
        "@crudo/nest may depend on @crudo/core and the @nestjs/* peers — " +
        "never on an ORM adapter. Adapters reach Nest's container via DI, " +
        "not via imports.",
      from: { path: "^packages/frameworks/nest" },
      to: { path: "^packages/orms" },
    },
    {
      name: "no-cross-package-deep-imports-core",
      severity: "error",
      comment:
        "Cross-package imports go through the package barrel (@crudo/core). " +
        "Deep imports into another package's src are not API.",
      from: { path: "^packages/(orms|frameworks)" },
      to: { path: "^packages/core/src/.+" },
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
