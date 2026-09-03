import { Idenzy } from "@idenzy/js";
import type { SessionSnapshot } from "@idenzy/js/session/session-store";
import { createIdenzy } from "@idenzy/vue";
import { defineNuxtPlugin, useRequestHeaders, useRuntimeConfig, useState } from "nuxt/app";
import { type IdenzyRuntimeOptions, RUNTIME_CONFIG_KEY, SESSION_STATE_KEY } from "./options.js";

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
  const options = useRuntimeConfig().public[RUNTIME_CONFIG_KEY] as IdenzyRuntimeOptions;
  const onServer = nuxtApp.ssrContext !== undefined;
  const seed = useState<SessionSnapshot | null>(SESSION_STATE_KEY, () => null);

  if (onServer) {
    // Dynamic so `@idenzy/node`, and the JWKS machinery under it, never reaches the browser
    // bundle. Nothing in here is code a client should be shipped.
    const { seedFromRequest } = await import("./server-session.js");
    seed.value = await seedFromRequest(options, useRequestHeaders(["cookie"]));
  }

  const client = new Idenzy({
    publishableKey: options.publishableKey,
    apiUrl: options.apiUrl,
    ...(options.sessionTransport === undefined
      ? {}
      : { sessionTransport: options.sessionTransport }),
    ...(options.deviceName === undefined ? {} : { deviceName: options.deviceName }),
  });

  nuxtApp.vueApp.use(
    createIdenzy({
      client,
      restore: !onServer,
      ...(seed.value === null ? {} : { initial: seed.value }),
    }),
  );
});
