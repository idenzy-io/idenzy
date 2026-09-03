import { addImports, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit";
import {
  type IdenzyRuntimeOptions,
  type IdenzyServerRuntimeOptions,
  RUNTIME_CONFIG_KEY,
} from "./runtime/options.js";

export type { IdenzyRuntimeOptions, IdenzyServerRuntimeOptions } from "./runtime/options.js";

export type ModuleOptions = IdenzyRuntimeOptions & {
  /**
   * The server-only half, which never reaches `runtimeConfig.public` and so never reaches a
   * bundle. In practice a customer leaves this out of `nuxt.config` entirely and sets
   * `NUXT_IDENZY_SECRET_KEY` in the environment, which is what the empty default below is for.
   */
  readonly server?: IdenzyServerRuntimeOptions;
};

/**
 * The Nuxt module: `modules: ["@idenzy/nuxt"]` and a key, and the composables are there.
 *
 * It adds a plugin and three auto-imports and nothing else. There is no page, no middleware
 * that redirects anywhere of ours, and no component: route protection is a customer's own
 * middleware reading `useSession()`, because where an unauthenticated visitor should land is
 * a product decision and not ours to make (ADR-0002).
 *
 * What it writes goes to public runtime config, and everything there is public by
 * construction: a publishable key belongs in a bundle, and a project id and an issuer URL are
 * printed in every token we sign. The one exception is `server`, which goes to the private
 * half and is read only inside the dynamic import the plugin makes on the server.
 */
export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@idenzy/nuxt",
    configKey: RUNTIME_CONFIG_KEY,
    compatibility: { nuxt: ">=4.0.0" },
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    // Split before either half is written, so the secret has no path to the public object
    // even for a moment. `server` is peeled off by name rather than filtered out, because a
    // deny list gets a new secret added to it one release late.
    const { server, ...publicOptions } = options;

    // Merged rather than assigned, so a value already in nuxt.config wins over one passed to
    // the module. Runtime config is the layer meant to be overridden per environment.
    const runtime = nuxt.options.runtimeConfig.public as Record<string, unknown>;
    runtime[RUNTIME_CONFIG_KEY] = {
      ...publicOptions,
      ...((runtime[RUNTIME_CONFIG_KEY] ?? {}) as Record<string, unknown>),
    };

    // The private half, and `secretKey` is defaulted to empty rather than left out because
    // Nuxt only overrides keys that already exist: without it `NUXT_IDENZY_SECRET_KEY` is
    // read from the environment and silently discarded, which looks exactly like a revocation
    // set that is polling and finding nothing.
    const privateRuntime = nuxt.options.runtimeConfig as unknown as Record<string, unknown>;
    privateRuntime[RUNTIME_CONFIG_KEY] = {
      secretKey: "",
      ...server,
      ...((privateRuntime[RUNTIME_CONFIG_KEY] ?? {}) as Record<string, unknown>),
    };

    addPlugin(resolve("./runtime/plugin"));
    for (const name of ["useIdenzy", "useSession", "useUser"]) {
      addImports({ name, from: resolve("./runtime/composables") });
    }
  },
});
