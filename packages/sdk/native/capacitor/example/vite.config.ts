import { defineConfig } from "vite";

// `@idenzy/capacitor` is linked from `..`, so its own imports resolve from its real path, where
// there is no `@capacitor/core`. Deduped, it resolves from this app, the one copy Capacitor uses.
export default defineConfig({
  resolve: { dedupe: ["@capacitor/core"] },
});
