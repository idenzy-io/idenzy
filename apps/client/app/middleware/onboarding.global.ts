/**
 * Keeps the dashboard shut until there is a project to show, and keeps getting started
 * shut once there is.
 *
 * Global rather than a `middleware` line on each page, because the rule is about the panel
 * and not about any screen in it: a route added later would otherwise be reachable by
 * somebody with no organisation, and the failure is quiet — every store keys on a project
 * id that does not exist and the screen renders empty rather than broken.
 *
 * It redirects in both directions. A person mid-onboarding who types `/users` is sent
 * back, and a person who already has an organisation and finds `/getting-started` is sent
 * to the dashboard: that form creates things, and leaving it reachable is leaving a second
 * organisation one submit away for somebody who only wanted to look.
 *
 * The signed-out case is deliberately not handled here. That is the SDK's redirect once
 * the panel builds a client, and a second answer to "are you signed in" in this file would
 * be a second thing to keep true.
 */

/** Reachable with an account and no organisation. Everything else needs one. */
const WITHOUT_ORGANISATION = "/getting-started";

/** The screens that belong to somebody who is not signed in at all. */
function isPublic(path: string): boolean {
  return path.startsWith("/auth/");
}

export default defineNuxtRouteMiddleware((to) => {
  if (isPublic(to.path)) return;

  const onboarding = useOnboardingStore();

  if (onboarding.required && to.path !== WITHOUT_ORGANISATION) {
    return navigateTo(WITHOUT_ORGANISATION);
  }
  if (!onboarding.required && to.path === WITHOUT_ORGANISATION) {
    return navigateTo("/");
  }
});
