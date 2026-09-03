import { defineConfig } from "vitest/config";

/**
 * Node, and deliberately no document.
 *
 * The suite runs inside each binding's own suite, in whatever environment that binding needs,
 * so nothing in `src` may depend on one being there. Its own tests exercise it against a
 * reference binding built straight on `SessionStore`, which is the one implementation that
 * needs no framework and no DOM at all.
 */
export default defineConfig({
  test: {
    environment: "node",
  },
});
