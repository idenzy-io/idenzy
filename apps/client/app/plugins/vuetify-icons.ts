import { aliases, materialSymbols } from "~/icons/material-symbols";

/**
 * Installs the Material Symbols icon set.
 *
 * It has to happen here rather than in `nuxt.config.ts`, because an icon set is a
 * component and nuxt.config is serialised. `vuetify-nuxt-module` is told `defaultSet:
 * "custom"`, which is the one value that makes it leave `icons` alone for us to fill in;
 * any other value and it would overwrite this from the build-time configuration.
 *
 * Runs before the module's own plugin (order 25) because Nuxt plugins default to 0.
 */
export default defineNuxtPlugin({
  name: "idenzy:vuetify-icons",
  setup(nuxtApp) {
    nuxtApp.hook("vuetify:before-create", ({ vuetifyOptions }) => {
      vuetifyOptions.icons = { defaultSet: "ms", aliases, sets: { ms: materialSymbols } };
    });
  },
});
