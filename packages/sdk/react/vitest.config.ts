import { defineConfig } from "vitest/config";

/**
 * Hooks need a document to render into, which is the one thing `@idenzy/js` is built to do
 * without. The environment stops here: nothing in `src` may reach for a Node global, and the
 * package's own `tsconfig` sets `types: []` so it cannot.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
