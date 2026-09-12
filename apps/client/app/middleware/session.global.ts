/**
 * Who may see which half of the panel: signed in, or not.
 *
 * Global rather than a line on each page, because the rule is about the panel and not
 * about any screen in it — a route added later must not be reachable by a visitor with no
 * session, and the failure would be quiet: the stores would fetch, every call would come
 * back 401, and the screen would render empty rather than broken.
 *
 * It redirects in both directions. A signed-out visitor anywhere in the panel is sent to
 * sign in, and a signed-in one who opens the sign-in screen is sent to the dashboard,
 * because a form that creates a second session is not what somebody who already has one
 * came for.
 *
 * `loading` is the third state and the reason this is not a boolean. `@idenzy/js` restores
 * a session from the refresh cookie on boot, which is a round trip; treating "not yet
 * known" as "signed out" is what makes a panel flash its sign-in screen at somebody who is
 * already signed in. Nothing is decided until the answer is in.
 *
 * Where an unauthenticated visitor lands is our decision and not the SDK's. `@idenzy/nuxt`
 * ships no middleware of its own for exactly that reason (ADR-0002): it is a product
 * question, and this file is the product answering it.
 */

/** The screens that belong to somebody with no session. */
function isPublic(path: string): boolean {
  return path.startsWith("/auth/");
}

export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSession();

  // On a full page load the client is still restoring. Waiting is what keeps the sign-in
  // screen from being shown to somebody who turns out to be signed in.
  if (session.value.status === "loading") {
    await until(() => session.value.status).not.toBe("loading");
  }

  const signedIn = session.value.status === "signed-in";

  if (!signedIn && !isPublic(to.path)) {
    // `redirect` so sign-in can return them to the page they actually asked for. A person
    // who followed a link to one screen and was bounced to another has lost their place.
    return navigateTo({ path: "/auth/login", query: { redirect: to.fullPath } });
  }
  if (signedIn && isPublic(to.path)) {
    return navigateTo("/");
  }
});
