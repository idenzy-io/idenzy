import { defineConfig } from "vitest/config";

/**
 * Tests import from dist rather than src.
 *
 * Vitest 4 transforms with Rolldown, which does not apply the legacy decorator
 * semantics NestJS DI depends on, so a decorated class fails to parse. Compiling with
 * tsc first sidesteps that and has a second benefit: the tests exercise the artifact
 * that actually ships, not a separately transformed copy of the source.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.integration.test.ts"],
  },
});
