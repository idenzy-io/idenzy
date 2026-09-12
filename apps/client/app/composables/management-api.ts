import { createFetch } from "@vueuse/core";

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
 * `__Host-` cookies the auth API sets are locked to its own hostname: one written by
 * `auth.idenzy.dev` is never sent to `api.idenzy.dev`, by construction. A Bearer token is
 * the only credential that can cross, which is also why this service allows no credentials
 * in its CORS policy — there are none to allow.
 */

/** Where the service lives. Its own key: `@idenzy/nuxt` owns the `idenzy` block. */
function baseUrl(): string {
  const runtime = useRuntimeConfig();
  const configured = runtime.public.managementApiUrl;
  return typeof configured === "string" && configured.length > 0
    ? configured.replace(/\/$/, "")
    : "http://localhost:3002";
}

/**
 * The client, built once per calling scope.
 *
 * `useIdenzy()` is resolved here, during setup, and the token is read inside `beforeFetch`
 * at request time. That ordering is what keeps this usable from a Pinia store: `inject`
 * needs a component or app context and a request does not have one, so the client is
 * captured while there is still a context to capture it from.
 */
export function useManagementApi() {
  const idenzy = useIdenzy();

  return createFetch({
    baseUrl: baseUrl(),
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
