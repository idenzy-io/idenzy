import { addImports, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit";
import { type IdenzyRuntimeOptions, RUNTIME_CONFIG_KEY } from "./runtime/options.js";

export type { IdenzyRuntimeOptions } from "./runtime/options.js";

export type ModuleOptions = IdenzyRuntimeOptions;

/**
 * The Nuxt module: `modules: ["@idenzy/nuxt"]` and a key, and the composables are there.
 *
 * It adds a plugin and three auto-imports and nothing else. There is no page, no middleware
 * that redirects anywhere of ours, and no component: route protection is a customer's own
 * middleware reading `useSession()`, because where an unauthenticated visitor should land is
 * a product decision and not ours to make (ADR-0002).
 *
 * Everything it writes goes to *public* runtime config, and everything there is public by
 * construction: a publishable key belongs in a bundle, and a project id and an issuer URL are
 * printed in every token we sign.
 */
export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@idenzy/nuxt",
    configKey: RUNTIME_CONFIG_KEY,
    compatibility: { nuxt: ">=4.0.0" },
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    // Merged rather than assigned, so a value already in nuxt.config wins over one passed to
    // the module. Runtime config is the layer meant to be overridden per environment.
    const runtime = nuxt.options.runtimeConfig.public as Record<string, unknown>;
    runtime[RUNTIME_CONFIG_KEY] = {
      ...options,
      ...((runtime[RUNTIME_CONFIG_KEY] ?? {}) as Record<string, unknown>),
    };

    addPlugin(resolve("./runtime/plugin"));
    for (const name of ["useIdenzy", "useSession", "useUser"]) {
      addImports({ name, from: resolve("./runtime/composables") });
    }
  },
});
