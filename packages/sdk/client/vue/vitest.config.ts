import { defineConfig } from "vitest/config";

/** Composables need a document to mount into, which is the one thing `@idenzy/js` is built to do without. */
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
