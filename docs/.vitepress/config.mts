import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Kavo",
  description: "A production-grade CRUD framework for TypeScript",
  base: "/",
  srcDir: ".",
  srcExclude: ["README.md"],
  cleanUrls: true,
  ignoreDeadLinks: [/CLAUDE(\.md)?$/],
  appearance: "dark",

  head: [
    ["meta", { property: "og:title", content: "Kavo" }],
    ["meta", { property: "og:description", content: "A production-grade CRUD framework for TypeScript" }],
    ["meta", { name: "theme-color", content: "#7c5cff" }],
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  ],

  themeConfig: {
    nav: [{ text: "Guide", link: "/architecture/01-system-architecture" }],

    sidebar: [
      {
        text: "Blueprint",
        items: [
          { text: "System architecture", link: "/architecture/01-system-architecture" },
          { text: "Monorepo and packages", link: "/architecture/02-monorepo-and-packages" },
          { text: "Core contracts and type system", link: "/architecture/03-core-contracts-and-type-system" },
        ],
      },
      {
        text: "Walking skeleton",
        items: [
          { text: "DTO system", link: "/architecture/04-dto-system" },
          { text: "Query grammar", link: "/architecture/05-query-grammar" },
          { text: "Error handling", link: "/architecture/06-error-handling" },
          { text: "CRUD engine", link: "/architecture/07-crud-engine" },
          { text: "Configuration", link: "/architecture/08-configuration" },
          { text: "TypeORM adapter", link: "/architecture/09-typeorm-adapter" },
          { text: "NestJS integration", link: "/architecture/10-nestjs-integration" },
        ],
      },
      {
        text: "Core features",
        items: [
          { text: "Soft delete", link: "/architecture/11-soft-delete" },
          { text: "Relations and includes", link: "/architecture/12-relations-and-includes" },
          { text: "GraphQL binding", link: "/architecture/13-graphql-binding" },
          { text: "Prisma adapter", link: "/architecture/14-prisma-adapter" },
        ],
      },
      {
        text: "Reference",
        items: [{ text: "Glossary", link: "/glossary" }],
      },
      {
        text: "ADRs",
        collapsed: true,
        items: [
          {
            text: "0001 — Clean architecture, core owns contracts",
            link: "/adr/0001-clean-architecture-core-owns-contracts",
          },
          { text: "0002 — Package topology", link: "/adr/0002-package-topology" },
          { text: "0003 — pnpm, plain scripts, tsc build", link: "/adr/0003-pnpm-plain-scripts-tsc-build" },
          { text: "0004 — Lockstep versioning", link: "/adr/0004-lockstep-versioning" },
          { text: "0005 — Core zero runtime dependencies", link: "/adr/0005-core-zero-runtime-dependencies" },
          { text: "0006 — Registry-driven operations", link: "/adr/0006-registry-driven-operations" },
          {
            text: "0007 — Module-augmentable operation metadata",
            link: "/adr/0007-module-augmentable-operation-metadata",
          },
          { text: "0008 — Field-path recursion cap", link: "/adr/0008-field-path-recursion-cap" },
          { text: "0009 — Problem-details error shape", link: "/adr/0009-problem-details-error-shape" },
          { text: "0010 — Explicit named barrel", link: "/adr/0010-explicit-named-barrel" },
          { text: "0011 — Entity-metadata infrastructure seam", link: "/adr/0011-entity-metadata-infrastructure-seam" },
          { text: "0012 — Decoration-time route generation", link: "/adr/0012-decoration-time-route-generation" },
          {
            text: "0013 — Config-declared soft-delete operations",
            link: "/adr/0013-config-declared-soft-delete-operations",
          },
          { text: "0014 — Associate by id, not deep writes", link: "/adr/0014-associate-by-id-not-deep-writes" },
          {
            text: "0015 — Global operation defaults are engine-only",
            link: "/adr/0015-global-operation-defaults-are-engine-only",
          },
          { text: "0016 — GraphQL protocols package", link: "/adr/0016-graphql-protocols-package" },
          {
            text: "0017 — Prisma marker classes and entity registry",
            link: "/adr/0017-prisma-marker-classes-and-entity-registry",
          },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/kavo-labs/kavo" }],

    search: {
      provider: "local",
    },

    footer: {
      copyright: `Built by the Kavo community`,
    },
  },
});
