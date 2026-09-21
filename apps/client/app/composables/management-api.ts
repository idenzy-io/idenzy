import { RUNTIME_CONFIG_KEY } from "@idenzy/nuxt/runtime/options";
import { createFetch } from "@vueuse/core";
import { refusalIn } from "~/utils/sign-in-errors";

/**
 * How the panel asks the management API for its own data.
 *
 * VueUse rather than `$fetch`, which is the convention for every call this panel makes on
 * its own behalf (docs/guide/panel.md). These requests feed screens rather than flows: a
 * screen wants `data`, `error` and `isFetching` as refs it can render and an `abort` when
 * the reader navigates away mid-request, and rebuilding that at each call site is how one
 * screen ends up with a spinner that never stops.
 *
 * Authentication is not this file's business. `@idenzy/js` holds the session and this
 * borrows one access token per request from it, so there is exactly one thing in the panel
 * that knows whether somebody is signed in.
 *
 * **The token and not the session cookie, and the reason is not preference.** The
 * `__Host-` cookies the auth API sets are locked to the hostname that wrote them, so a
 * cookie set on a customer's auth domain never reaches a management route. A Bearer token
 * is the only credential that can, which is why the dashboard surface allows no
 * credentials in its CORS policy — there are none to allow.
 *
 * **One host now.** The management API was its own deployment on its own port and this
 * read `NUXT_PUBLIC_MANAGEMENT_API_URL`; the two services are one, so this reads the same
 * base the SDK authenticates against. Keeping a second variable would have meant a
 * deployment could point the two halves of the panel at different hosts, which is a
 * misconfiguration with no symptom until a screen fails.
 */

/**
 * The client, usable from a component, a store action or route middleware.
 *
 * Both `useIdenzy()` and `useRuntimeConfig()` reach for a context that only exists while a
 * component is being set up — `useIdenzy` through Vue's `inject`, which returns `undefined`
 * outside one rather than throwing. That undefined then fails as
 * `Cannot read properties of undefined (reading 'client')`, several frames from the call
 * that caused it, which is precisely how this was found.
 *
 * `runWithContext` is what removes the constraint instead of documenting it. A store action
 * runs long after setup, and a rule that said "only call this during setup" would be a rule
 * every future store has to remember; restoring the context here means none of them do.
 */
export function useManagementApi() {
  const nuxt = useNuxtApp();
  const inContext = <T>(resolve: () => T): T => nuxt.vueApp.runWithContext(resolve);

  const idenzy = inContext(() => useIdenzy());
  const configured = inContext(() => {
    const block = useRuntimeConfig().public[RUNTIME_CONFIG_KEY] as { apiUrl?: string } | undefined;
    return block?.apiUrl ?? "";
  });
  const baseUrl = configured.length > 0 ? configured.replace(/\/$/, "") : "http://localhost:3001";

  return createFetch({
    baseUrl,
    options: {
      async beforeFetch({ options }) {
        const token = await idenzy.getToken();
        // No header at all rather than `Bearer null`. A request with no credential is
        // refused as unauthenticated, which is the truth; a malformed one reads to
        // whoever is debugging as a token that was rejected.
        if (token !== null) {
          options.headers = { ...options.headers, Authorization: `Bearer ${token}` };
        }
        return { options };
      },
      /**
       * Hands a refusal back as the error contract's own document rather than as a status
       * line.
       *
       * VueUse puts `Error.message` into `error.value`, which for a non-2xx is the status
       * text — and a status text carries no code, so every screen built on
       * `managementMessage` would say "something went wrong" about a refusal the server had
       * explained precisely. The body is parsed before the status is judged, so the shape
       * the service promised (PROJECT.md 9.3) is already here to hand over.
       */
      onFetchError(context) {
        return { ...context, error: refusalIn(context.data) ?? context.error };
      },
    },
    fetchOptions: {
      // Deliberately omitted: `credentials: "include"`. This API answers a Bearer token
      // and sets no cookies, and asking the browser to attach ambient credentials to a
      // cross-origin request is how an API that had no CSRF surface acquires one.
      headers: { Accept: "application/json" },
    },
  });
}

/**
 * The same client, awaited, for code that wants a value rather than refs.
 *
 * A store loading once on sign-in is not a component rendering a request, so handing it
 * `isFetching` would be handing it a ref nothing watches. `createFetch`'s composable is
 * thenable, so the call site reads:
 *
 * ```ts
 * const api = useManagementApi();
 * const { data, error } = await api("/v1/me").get().json<Me>();
 * if (error.value !== null) throw error.value;
 * ```
 *
 * Screens use the refs directly and never this shape.
 */
