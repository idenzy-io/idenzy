import { IDENZY, type IdenzyContext } from "@idenzy/vue";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type App, createApp, inject } from "vue";
import type { IdenzyRuntimeOptions } from "../src/runtime/options.js";

/**
 * What the mocked `nuxt/app` reads, held where a hoisted `vi.mock` factory can reach it.
 *
 * The factory runs before this file's own statements, so a plain `let` would still be in its
 * temporal dead zone when the plugin is first imported.
 */
const nuxt = vi.hoisted(() => ({
  config: {} as IdenzyRuntimeOptions,
  headers: {} as Record<string, string | undefined>,
}));

/**
 * Nuxt's composables, reduced to the four the plugin calls.
 *
 * `defineNuxtPlugin` is identity here, which is what makes the plugin a function this file can
 * call with an app it built. Nothing else in Nuxt is involved in what these tests check.
 */
vi.mock("nuxt/app", async () => {
  const { ref } = await import("vue");
  return {
    defineNuxtPlugin: (setup: unknown) => setup,
    useRuntimeConfig: () => ({ public: { idenzy: nuxt.config } }),
    useRequestHeaders: () => nuxt.headers,
    useState: (_key: string, init: () => unknown) => ref(init()),
  };
});

const plugin = (await import("../src/runtime/plugin.js")).default;

/**
 * The two properties of `NuxtApp` the plugin touches.
 *
 * Building a real one is not possible outside a Nuxt build, and transcribing what is used is
 * what this repository does for a framework type it will not depend on. The cast is here
 * rather than at every call.
 */
interface PluginInput {
  readonly ssrContext: object | undefined;
  readonly vueApp: App;
}

const install = plugin as unknown as (nuxtApp: PluginInput) => Promise<void>;

let fetches: string[];

beforeAll(() => {
  fetches = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    fetches.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: "invalid_credentials", message: "no", requestId: "req_test" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
  });
});

afterEach(() => {
  fetches.length = 0;
  nuxt.headers = {};
});

function options(overrides: Partial<IdenzyRuntimeOptions> = {}): IdenzyRuntimeOptions {
  return { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test", ...overrides };
}

/** Runs the plugin against a real Vue app and hands back what a composable would inject. */
async function run(ssrContext: object | undefined): Promise<IdenzyContext> {
  const app = createApp({});
  await install({ ssrContext, vueApp: app });
  const context = app.runWithContext(() => inject(IDENZY, null));
  expect(context).not.toBeNull();
  return context!;
}

/** Long enough for the restore, its parse and the store publish behind it. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("the plugin on the server", () => {
  /**
   * The module's default configuration: `projectId` is optional, and without one the seed is
   * null for every visitor. Null is this server reporting that it looked and could not tell,
   * so the render holds `loading` and the browser settles it. Signed out here would put a
   * sign-in screen in the HTML of every page the site renders.
   */
  it("holds loading where it has no way to place the visitor", async () => {
    nuxt.config = options();

    const context = await run({});

    expect(context.session.value.status).toBe("loading");
  });

  /** The refresh cookie is the browser's to spend, and this server does not hold it. */
  it("does not restore, so the render costs no request to the auth API", async () => {
    nuxt.config = options();

    await run({});
    await flush();

    expect(fetches).toHaveLength(0);
  });

  /**
   * One client per app, which on a server is one per request. A module singleton would be a
   * session shared between people, and two clients rotating one token revoke the family
   * (ADR-0007).
   */
  it("builds a client per app rather than sharing one", async () => {
    nuxt.config = options();

    const first = await run({});
    const second = await run({});

    expect(first.client).not.toBe(second.client);
  });
});

describe("the plugin in the browser", () => {
  it("restores, which is the whole reason a page does not start signed out", async () => {
    nuxt.config = options();

    const context = await run(undefined);
    await flush();

    expect(fetches.length).toBeGreaterThan(0);
    expect(context.session.value.status).toBe("signed-out");
  });
});
