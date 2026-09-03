import { defineConfig } from "vitest/config";

/** A CLI writes files and reads a package.json, so node with a real one is the environment. */
export default defineConfig({
  test: {
    environment: "node",
  },
});
