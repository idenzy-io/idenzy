import { Idenzy } from "@idenzy/js";

/**
 * One client for the whole browser session, built once and outside any render.
 *
 * An Idenzy owns the session, the refresh token and the single-flight refresh that keeps one
 * rotation from becoming two. Two clients on a page rotate the same token, and the second
 * rotation ends every session the user holds.
 */
export const idenzy = new Idenzy({
  // Dot access, not process.env["..."]: Next inlines NEXT_PUBLIC_ variables by matching the
  // literal text, and a bracket lookup is left as an undefined read in the browser bundle.
  publishableKey: process.env.NEXT_PUBLIC_IDENZY_PUBLISHABLE_KEY ?? "",
  apiUrl: process.env.NEXT_PUBLIC_IDENZY_API_URL ?? "",
});
