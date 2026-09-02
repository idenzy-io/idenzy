import { defineConfig } from "vitest/config";

/** Container-backed tests. Slower and needs Docker, so it is a separate task from unit. */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
