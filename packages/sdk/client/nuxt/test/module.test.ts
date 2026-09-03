import { describe, expect, it, vi } from "vitest";
import type { ModuleOptions } from "../src/module.js";

/**
 * `@nuxt/kit` reduced to the four things the module calls.
 *
 * `defineNuxtModule` is identity, which is what makes `setup` a function this file can call
 * with a `nuxt` object it built. The other three only record that they were asked, because
 * where the plugin file resolves to needs a real Nuxt build to mean anything and is not what
 * these tests are about.
 */
vi.mock("@nuxt/kit", () => ({
  defineNuxtModule: (definition: unknown) => definition,
  createResolver: () => ({ resolve: (path: string) => path }),
  addPlugin: () => undefined,
  addImports: () => undefined,
}));

const module_ = (await import("../src/module.js")).default as unknown as {
  setup: (options: ModuleOptions, nuxt: FakeNuxt) => void;
};

interface FakeNuxt {
  options: { runtimeConfig: { public: Record<string, unknown> } & Record<string, unknown> };
}

function setup(
  options: ModuleOptions,
  existing: Partial<FakeNuxt["options"]["runtimeConfig"]> = {},
) {
  const nuxt: FakeNuxt = {
    options: { runtimeConfig: { public: {}, ...existing } as FakeNuxt["options"]["runtimeConfig"] },
  };
  module_.setup(options, nuxt);
  return nuxt.options.runtimeConfig;
}

const BASE: ModuleOptions = { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" };

describe("what the module writes to runtime config", () => {
  it("puts the browser half in the public object", () => {
    const config = setup({ ...BASE, projectId: "prj_00000000000000000001" });

    expect(config.public["idenzy"]).toMatchObject({
      publishableKey: "pk_test_abc",
      apiUrl: "https://auth.acme.test",
      projectId: "prj_00000000000000000001",
    });
  });

  /**
   * The one that must never regress. Public runtime config is serialised into the payload
   * every visitor downloads, and the revocation set's key is a project's secret key: it reads
   * the set, which names users and times their security events, and it is the same credential
   * a server SDK authenticates with.
   */
  it("keeps the secret key out of the public half entirely", () => {
    const config = setup({ ...BASE, server: { secretKey: "sk_live_do_not_ship" } });

    expect(JSON.stringify(config.public)).not.toContain("sk_live_do_not_ship");
    expect(config.public["idenzy"]).not.toHaveProperty("server");
    expect(config.public["idenzy"]).not.toHaveProperty("secretKey");
  });

  it("puts it in the private half, where only the server reads it", () => {
    const config = setup({ ...BASE, server: { secretKey: "sk_live_do_not_ship" } });

    expect(config["idenzy"]).toMatchObject({ secretKey: "sk_live_do_not_ship" });
  });

  /**
   * Nuxt overrides a runtime config key from the environment only where the key already
   * exists. Without the empty default, `NUXT_IDENZY_SECRET_KEY` is read and discarded, which
   * looks exactly like a set that is polling and finding nothing revoked.
   */
  it("leaves an empty secret key behind for the environment to override", () => {
    const config = setup(BASE);

    expect(config["idenzy"]).toEqual({ secretKey: "" });
  });

  it("lets a value already in nuxt.config win over one passed to the module", () => {
    const config = setup(
      { ...BASE, server: { secretKey: "sk_from_module" } },
      { idenzy: { secretKey: "sk_from_nuxt_config" } },
    );

    expect(config["idenzy"]).toMatchObject({ secretKey: "sk_from_nuxt_config" });
  });
});
