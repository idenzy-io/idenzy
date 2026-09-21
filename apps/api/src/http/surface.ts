/**
 * Which of the two surfaces a request is on, decided from its path.
 *
 * One service now answers both: the public authentication API a customer's end users
 * reach, and the dashboard API our own panel reaches. They were separate deployments and
 * the split was not cosmetic — they authenticate differently, they trust different
 * origins, and only one of them takes credentials from a browser. Merging them without
 * saying which is which would have quietly given every management route the auth API's
 * CORS policy, which allows credentials.
 *
 * **From the path rather than from a decorator, and that is deliberate.** The CORS policy
 * is bound to Fastify and runs in an `onSend` hook, outside the request's Nest context,
 * so it cannot read route metadata; the guards can. A decorator would mean the two
 * decided the same question from different sources and could disagree — which is exactly
 * the failure this function exists to prevent. One table, read by both.
 *
 * The prefixes are disjoint and were disjoint before the merge, which is what made it
 * safe: `/v1/sessions` is the auth API's, `/v1/orgs/:orgId/projects/:projectId/sessions`
 * is the dashboard's, and no path belongs to both.
 */
export const Surface = {
  /** The public API. Tenant resolved from a key or the Host, per-project CORS. */
  Auth: "auth",
  /** Our own panel. Dashboard token, one origin, no credentials. */
  Dashboard: "dashboard",
  /** Health and discovery. No tenant, cacheable, wildcard origin. */
  Public: "public",
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/** Exact paths and prefixes that are not the auth API. Longest match is not needed: none nests. */
const DASHBOARD_PREFIXES = ["/v1/me", "/v1/onboarding", "/v1/orgs", "/v1/payments"] as const;
const PUBLIC_PREFIXES = ["/healthz", "/readyz", "/.well-known"] as const;

/**
 * The surface a path belongs to.
 *
 * **Auth is the default, and the default is the security-relevant part.** A route added
 * under a prefix nobody listed here is treated as the public API, which means
 * `TenantResolutionGuard` demands a tenant for it and refuses without one. The failure
 * mode of guessing wrong is therefore a route that will not serve until somebody looks at
 * it, rather than a dashboard route quietly served with credentials allowed.
 */
export function surfaceOf(path: string | undefined): Surface {
  // A fabricated request in a unit test has no url. Auth is the answer for the same reason
  // it is the answer for an unrecognised prefix: it is the one that demands a tenant.
  if (path === undefined) return Surface.Auth;
  const url = path.split("?")[0] ?? path;
  if (PUBLIC_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) {
    return Surface.Public;
  }
  if (DASHBOARD_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) {
    return Surface.Dashboard;
  }
  return Surface.Auth;
}
