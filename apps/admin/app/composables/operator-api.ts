import { RUNTIME_CONFIG_KEY } from "@idenzy/nuxt/runtime/options";
import { createFetch } from "@vueuse/core";

/**
 * The operator API, with the signed-in operator's token on every request (ADR-0018).
 *
 * VueUse's `createFetch`, as in the customer panel. The token is the operator project's and is
 * sent as a Bearer header — the operator surface reads nothing else — and no header at all is
 * sent when there is no session, so the API's refusal says "not signed in" rather than "bad
 * token".
 */
export function useOperatorApi() {
  const nuxt = useNuxtApp();
  const idenzy = nuxt.vueApp.runWithContext(() => useIdenzy());
  const block = useRuntimeConfig().public[RUNTIME_CONFIG_KEY] as { apiUrl?: string } | undefined;
  const baseUrl = (block?.apiUrl ?? "http://localhost:3001").replace(/\/$/, "");

  return createFetch({
    baseUrl,
    options: {
      async beforeFetch({ options }) {
        const token = await idenzy.getToken();
        if (token !== null) {
          options.headers = { ...options.headers, Authorization: `Bearer ${token}` };
        }
        return { options };
      },
    },
    fetchOptions: { mode: "cors" },
  });
}
