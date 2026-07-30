import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * One vitest run for the whole monorepo. Tests live in each package's
 * `tests/` directory (outside `src/`, so they are never compiled into
 * `dist/` or shipped).
 *
 * The swc plugin is required by the TypeORM / NestJS projects: vitest's
 * default esbuild transform cannot emit decorator metadata, which TypeORM
 * entities and Nest DI rely on. Core is plain TypeScript and would not
 * need it, but one uniform transform keeps behavior identical everywhere.
 */
const swcPlugin = swc.vite({
  jsc: {
    parser: { syntax: "typescript", decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    target: "es2022",
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  resolve: {
    // Tests exercise workspace sources directly — no stale-dist hazard.
    alias: {
      "@kavo/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@kavo/typeorm": new URL("./packages/orms/typeorm/src/index.ts", import.meta.url).pathname,
      "@kavo/nest": new URL("./packages/frameworks/nest/src/index.ts", import.meta.url).pathname,
      "@kavo/graphql": new URL("./packages/protocols/graphql/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["packages/**/tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 30_000,
  },
});
