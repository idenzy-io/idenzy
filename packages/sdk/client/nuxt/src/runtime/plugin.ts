import { Idenzy } from "@idenzy/js";
import type { SessionSnapshot } from "@idenzy/js/session/session-store";
import { createIdenzy } from "@idenzy/vue";
import { defineNuxtPlugin, useRequestHeaders, useRuntimeConfig, useState } from "nuxt/app";
import {
  type IdenzyRuntimeOptions,
  type IdenzyServerRuntimeOptions,
  RUNTIME_CONFIG_KEY,
  SESSION_STATE_KEY,
} from "./options.js";

/**
 * One client per Nuxt app, which on the server means one per request.
 *
 * That is the property SSR needs and the reason the client is not a module singleton: two
 * requests sharing a client would share a session, which on a server rendering for different
 * people is the worst bug this SDK could have.
 *
 * The server verifies the session cookie itself and puts the answer in the payload, so the
 * browser hydrates from the same snapshot the HTML was rendered from rather than swapping the
 * tree once it works it out. Restoring happens in the browser only: the rotation is the
 * browser's cookie to spend, and a server doing it would rotate a token it cannot store.
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig();
  const options = config.public[RUNTIME_CONFIG_KEY] as IdenzyRuntimeOptions;
  const onServer = nuxtApp.ssrContext !== undefined;
  const seed = useState<SessionSnapshot | null>(SESSION_STATE_KEY, () => null);

  if (onServer) {
    // Read inside the server branch, not above it. The private half of runtime config is an
    // empty object in the browser, and reading it there would be harmless today and a habit
    // that stops being harmless the first time somebody logs what it holds.
    const server = (config as unknown as Record<string, IdenzyServerRuntimeOptions | undefined>)[
      RUNTIME_CONFIG_KEY
    ];
    // Dynamic so `@idenzy/node`, and the JWKS machinery under it, never reaches the browser
    // bundle. Nothing in here is code a client should be shipped.
    const { seedFromRequest } = await import("./server-session.js");
    seed.value = await seedFromRequest(options, useRequestHeaders(["cookie"]), server ?? {});
  }

  const client = new Idenzy({
    publishableKey: options.publishableKey,
    apiUrl: options.apiUrl,
    ...(options.sessionTransport === undefined
      ? {}
      : { sessionTransport: options.sessionTransport }),
    ...(options.deviceName === undefined ? {} : { deviceName: options.deviceName }),
  });

  // The seed goes in as it is, null included. Null is this server saying it looked and could
  // not place the visitor, which holds `loading` until the browser settles it. Dropping the
  // key would say nobody looked, and with `restore: false` on the server that renders the
  // signed-out tree at every visitor the cookie did not name, which is most of them and all of
  // them where `projectId` is not configured.
  nuxtApp.vueApp.use(createIdenzy({ client, restore: !onServer, initial: seed.value }));
});
