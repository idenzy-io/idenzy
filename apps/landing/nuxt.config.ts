/**
 * Marketing site and docs shell (PROJECT.md 10.1).
 *
 * SSR on, and it is the only panel where that is true: this content is indexed, shared,
 * and judged on first paint. Route rules push most of it to the edge so SSR cost stays
 * flat as traffic grows rather than scaling per view.
 *
 * Calls no authenticated API. If a page needs user state it links to the client panel;
 * the two never share a bundle or a token.
 */
export default defineNuxtConfig({
  ssr: true,
  compatibilityDate: "2026-09-01",
  typescript: { strict: true, typeCheck: false },
  routeRules: {
    "/": { prerender: true },
    "/pricing": { prerender: true },
    "/docs/**": { swr: 3600 },
  },
  app: {
    head: {
      titleTemplate: "%s | Idenzy",
      meta: [{ name: "description", content: "Authentication as an API. No UI, ever." }],
    },
  },
});
