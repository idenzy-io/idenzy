import { pluginReactLynx } from "@lynx-js/react-rsbuild-plugin";
import { defineConfig } from "@lynx-js/rspeedy";

// One page, `dist/main.lynx.bundle`, which both host apps load from their own resources.
export default defineConfig({
  plugins: [pluginReactLynx()],
});
