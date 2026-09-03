import { defineConfig } from "vitest/config";

/**
 * Solid ships two builds of itself and Node resolves the wrong one.
 *
 * Its `node` export condition is the SSR build, where `createEffect` does nothing and
 * `createMemo` computes once, so a test suite that took it would report a pass on a binding
 * whose reactivity never ran. `browser` is what a customer's bundler picks, and it is what
 * these tests have to exercise. `jsdom` is here to match that condition rather than because
 * anything under `src` touches a document.
 */
export default defineConfig({
  resolve: {
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    server: {
      deps: {
        inline: ["solid-js"],
      },
    },
  },
});
