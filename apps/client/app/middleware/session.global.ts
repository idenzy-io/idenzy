/**
 * Who may see which part of the panel, decided in one place and in one order.
 *
 * Three questions, and each only makes sense once the one before it is answered: is the
 * session known yet, is there a session at all, and does this account own anything. They
 * were two files until it became clear Nuxt runs global middleware alphabetically —
 * `onboarding` before `session` — so the onboarding check ran before anyone knew whether
 * there was even a session to check. One file is the fix, because the order is the whole
 * point and a filename is a poor place to keep it.
 *
 * Global rather than a line on each page: a route added later must not be reachable by a
 * visitor with no session, and the failure would be quiet. Every store would fetch, every
 * call would come back 401, and the screen would render empty rather than broken.
 *
 * Where an unauthenticated visitor lands is our decision and not the SDK's. `@idenzy/nuxt`
 * ships no middleware for exactly that reason (ADR-0002): it is a product question, and
 * this file is the product answering it.
 */

/** The screens that belong to somebody with no session at all. */
const PUBLIC_PREFIX = "/auth/";

/** Reachable with an account and no organisation. Everything else needs one. */
const GETTING_STARTED = "/getting-started";

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith(PUBLIC_PREFIX)) return;

  // `useSession` reads an injected value, and `inject` outside a component returns
  // undefined rather than throwing — which surfaces later as a property read on nothing.
  // Route middleware happens to run inside the app context today; restoring it explicitly
  // means this does not depend on that continuing to be true.
  const session = useNuxtApp().vueApp.runWithContext(() => useSession());

  // `loading` is a real third state, not a slow `false`. `@idenzy/js` restores a session
  // from the refresh cookie on boot, and treating "not yet known" as "signed out" is what
  // makes a panel flash its sign-in screen at somebody who is already signed in.
  if (session.value.status === "loading") {
    await until(() => session.value.status).not.toBe("loading");
  }

  if (session.value.status !== "signed-in") {
    // `redirect` so sign-in can return them to the page they asked for. Somebody who
    // followed a link to one screen and was bounced to another has lost their place.
    return navigateTo({ path: "/auth/login", query: { redirect: to.fullPath } });
  }

  // Only now is there somebody to load a context for.
  const bootstrap = useBootstrapStore();
  await bootstrap.load();

  // A bootstrap that failed is not an account with no organisations. Sending it to getting
  // started would offer to create a second one, so the panel renders and the screen says
  // what went wrong instead.
  if (bootstrap.status !== "ready") return;

  const needsOnboarding = bootstrap.organisations.length === 0;
  if (needsOnboarding && to.path !== GETTING_STARTED) return navigateTo(GETTING_STARTED);
  // A form that creates an organisation must not stay reachable for somebody who has one.
  if (!needsOnboarding && to.path === GETTING_STARTED) return navigateTo("/");
});
