/**
 * Mechanical enforcement of the package boundaries defined in
 * docs/internals/architecture/02-monorepo-and-packages.md.
 *
 * The rules here are the executable form of the dependency graph:
 *
 *   @kavo/nest ──▶ @kavo/core ◀── @kavo/typeorm
 *      │                ▲
 *      │                ├── @kavo/prisma
 *      │                ├── @kavo/mongoose
 *      │                ├── @kavo/mikroorm
 *      │                ├── @kavo/graphql ◀─┐
 *      │                └── @kavo/mcp     ◀─┤
 *      └── the one sanctioned sideways edge ┘
 *          (frameworks/* → protocols/*, ADR-0016; never the reverse)
 *
 * `@kavo/core` imports nothing. Every other package imports the `@kavo/core`
 * barrel and its own peer dependency, and nothing else from the workspace —
 * the single exception being `@kavo/nest`, which may also import the two
 * protocol barrels (ADR-0016). An illegal import fails CI here, not in code
 * review, and that now covers every edge in the diagram rather than a subset.
 *
 * Two spellings reach another package, and the rules below match both: a bare
 * workspace specifier (`@kavo/nest` — the spelling anyone would actually
 * write, and one that stays unresolved in the dependency graph, so a
 * path-only rule would miss it entirely) and a relative path that climbs out
 * of the package (`../../../frameworks/nest/src/...`). Checking one and not
 * the other leaves a boundary open in the spelling nobody audits.
 *
 * The three per-tier rules capture the package directory in `from` and refer
 * back to it as `$1` in `to.pathNot`, so same-package imports stay legal
 * while every sibling is forbidden. That back-reference is what makes a new
 * adapter or protocol package covered the day it is created, with no rule to
 * remember to extend — these rules used to be spelled one-per-package, which
 * meant every new package hand-edited every other package's rule, and the
 * prose describing the set drifted out of sync with it twice.
 */
module.exports = {
  forbidden: [
    {
      name: "core-imports-nothing",
      severity: "error",
      comment:
        "@kavo/core is the dependency-free hub: no other workspace package, " +
        "no node_modules — zero runtime dependencies (ADR-0005). Type-only " +
        "edges count: core owns its contracts (ADR-0001), so a type reached " +
        "for from outside is a contract core does not own, whether or not it " +
        "erases at compile time. Scoped to `src`: core's own tests " +
        "legitimately import the `@kavo/core` barrel and vitest, and are " +
        "governed by `core-tests-know-no-adapter` instead.",
      from: { path: "^packages/core/src" },
      to: { pathNot: "^packages/core" },
    },
    {
      name: "orm-adapters-only-import-core",
      severity: "error",
      comment:
        "An ORM adapter's `src` may import the `@kavo/core` barrel and its " +
        "own ORM peer — nothing else in the workspace. Not a framework " +
        "binding (ADR-0002: adapters reach Nest's container through DI, " +
        "never through an import), not a protocol binding, and not another " +
        "ORM adapter. `$1` is the adapter's own directory captured from " +
        "`from`, so its internal relative imports stay legal while every " +
        "sibling package is forbidden in both spellings.",
      from: { path: "^packages/orms/([^/]+)/src" },
      to: {
        path: "^(@kavo/|packages/)",
        pathNot: "^(@kavo/core$|packages/orms/$1/)",
      },
    },
    {
      name: "protocol-bindings-only-import-core",
      severity: "error",
      comment:
        "A protocol binding's `src` may import the `@kavo/core` barrel and " +
        "its own protocol peer — nothing else in the workspace. Not an ORM " +
        "adapter, not another protocol binding, and above all not a " +
        "framework binding: ADR-0016 makes protocols/* host-framework- " +
        "agnostic, and @kavo/nest importing them is what that edge is for. " +
        "This rule is the half that keeps the edge one-directional.",
      from: { path: "^packages/protocols/([^/]+)/src" },
      to: {
        path: "^(@kavo/|packages/)",
        pathNot: "^(@kavo/core$|packages/protocols/$1/)",
      },
    },
    {
      name: "framework-bindings-import-core-and-protocol-barrels",
      severity: "error",
      comment:
        "A framework binding's `src` may import the `@kavo/core` barrel plus " +
        "the two protocol barrels — @kavo/graphql for " +
        "BaseKavoGraphQLController and @kavo/mcp for BaseKavoMcpController. " +
        "That is the one sanctioned sideways edge (ADR-0016); " +
        "protocol-bindings-only-import-core is what stops it running the " +
        "other way. An ORM adapter is never importable (ADR-0002). The " +
        "allowlist is `$`-anchored on purpose, so the sideways edge stops at " +
        "the barrel: `@kavo/graphql/src/...` is still a deep import.\n\n" +
        "**This is the one rule in this file that names packages, and so the " +
        "one that needs editing when a package lands.** A new protocols/* " +
        "package that @kavo/nest is meant to glue (ADR-0016 anticipates a " +
        "future @kavo/grpc) must be added to the allowlist here, or the " +
        "sanctioned edge fails the gate. That is deliberate: an allowlist of " +
        "sideways edges should be explicit and reviewed, not inferred from " +
        "the directory layout the way the forbidding rules are — adding one " +
        "is an architectural decision, not a mechanical consequence.",
      from: { path: "^packages/frameworks/([^/]+)/src" },
      to: {
        path: "^(@kavo/|packages/)",
        pathNot: "^(@kavo/(core|graphql|mcp)$|packages/frameworks/$1/)",
      },
    },
    {
      name: "no-cross-package-deep-imports-core",
      severity: "error",
      comment:
        "Cross-package imports go through the package barrel (@kavo/core), " +
        "which is an explicit named list (ADR-0010). Deep imports into " +
        "another package's src are not API — matched as a relative path and " +
        "as a `@kavo/core/...` subpath. Broader than the per-tier rules " +
        "above: this one also covers each package's `tests/` and the " +
        "`examples/*` apps, which are the reference apps, so an illegal " +
        "import there teaches one.",
      from: { path: "^(packages/(orms|frameworks|protocols)|examples)" },
      to: { path: "^(packages/core/src/.+|@kavo/core/.+)" },
    },
    {
      name: "no-cross-package-deep-imports-adapters",
      severity: "error",
      comment: "Same rule for adapter/framework/protocol package internals.",
      from: { path: "^packages/core" },
      to: { path: "^packages/(orms|frameworks|protocols)/[^/]+/src/.+" },
    },
    {
      name: "no-deep-imports-through-a-barrel",
      severity: "error",
      comment:
        "The generalization of the two rules above to every remaining pair: " +
        "a package's barrel is its API and a subpath of it is not, for every " +
        "@kavo/* package rather than only @kavo/core. This is the rule that " +
        "catches one edge deep-importing another — `@kavo/mcp/src/...` from " +
        "@kavo/graphql, say — which the two core-anchored rules never looked " +
        "at. Written with no package list so it needs no edit when one lands.\n\n" +
        "**Both spellings, and this is the rule where that bites hardest.** A " +
        "deep specifier resolves to a real path whenever the importer has the " +
        "target as a genuine dependency — which is exactly the case in " +
        "`examples/*`, where `@kavo/typeorm/src/foo.js` lands in the graph as " +
        "`packages/orms/typeorm/src/foo.ts` and never matches the `@kavo/…` " +
        "half at all. Matching only the specifier form left every example-app " +
        "deep import unchecked, since the per-tier rules above are " +
        "`packages/**/src`-scoped and never look at `examples/`. `$1` is the " +
        "importing package root, so same-package relative imports stay legal.",
      from: {
        path: "^(packages/(?:core|orms/[^/]+|frameworks/[^/]+|protocols/[^/]+)|examples/[^/]+)/",
      },
      to: {
        path: "^(@kavo/[^/]+/.+|packages/(?:core|orms/[^/]+|frameworks/[^/]+|protocols/[^/]+)/src/.+)",
        pathNot: "^$1/",
      },
    },
    {
      name: "only-framework-bindings-import-a-host-framework",
      severity: "error",
      comment:
        "An ORM adapter and a protocol binding are both leaves that adapt " +
        "exactly one external technology, and a host framework is never it. " +
        "ADR-0002 puts it as 'an adapter must be usable from any future " +
        "framework binding'; doc 16 says @kavo/mcp 'has no idea Nest, " +
        "Express, or any other host exists'. The rules above cannot say this " +
        "— they gate on `to.path: ^(@kavo/|packages/)`, so a bare " +
        "`@nestjs/common` is outside what they look at, and a hard import of " +
        "it would break every consumer wiring the package into a non-Nest " +
        "host with `Cannot find module` at import time.",
      from: { path: "^packages/(orms|protocols)/[^/]+/src" },
      to: { path: "^@nestjs/" },
    },
    {
      name: "tests-no-other-package-internals",
      severity: "error",
      comment:
        "A test file may import its own package's source and the @kavo/* " +
        "barrels — never another package's `src` or `tests`. Sharing a " +
        "fixture by reaching into a sibling package's tests is the same " +
        "boundary violation as doing it in production code (ADR-0002), and " +
        "until this rule existed it was the one edge nothing enforced: " +
        "`tests/` used to be excluded from cruising entirely. The `$1` " +
        "back-reference is the package root captured from `from`, so " +
        "same-package imports stay legal.",
      from: {
        path: "^(packages/core|packages/orms/[^/]+|packages/frameworks/[^/]+|packages/protocols/[^/]+|examples/[^/]+)/tests/",
      },
      to: {
        path: "^(packages/core|packages/orms/[^/]+|packages/frameworks/[^/]+|packages/protocols/[^/]+|examples/[^/]+)/(src|tests)/",
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
        "still matters — no adapter, no framework — enforced for them too. " +
        "Spelled as `not @kavo/core` rather than as a package list, so a new " +
        "adapter or protocol package is covered the day it is created.",
      from: { path: "^packages/core/tests" },
      to: {
        path: "^(@kavo/|packages/(orms|frameworks|protocols))",
        pathNot: "^@kavo/core$",
      },
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
