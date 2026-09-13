import { defineConfig } from "vitest/config";

/** Needs the ClickHouse from `docker compose`, so it is a separate task from unit. */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
