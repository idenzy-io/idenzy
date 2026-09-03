import { Idenzy } from "@idenzy/js";

/**
 * One client for the whole browser session, built once and outside any component.
 *
 * An Idenzy owns the session, the refresh token and the single-flight refresh that keeps one
 * rotation from becoming two. Two clients on a page rotate the same token, and the second
 * rotation ends every session the user holds.
 */
export const idenzy = new Idenzy({
  publishableKey: import.meta.env.VITE_IDENZY_PUBLISHABLE_KEY ?? "",
  apiUrl: import.meta.env.VITE_IDENZY_API_URL ?? "",
});
