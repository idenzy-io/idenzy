import { defineConfig } from "vitest/config";

/** Unit only. The container-backed ones are `test:integration`, which needs Docker. */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.integration.test.ts"],
  },
});
