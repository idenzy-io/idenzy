/**
 * Customer dashboard (PROJECT.md 10.1).
 *
 * SSR off, deliberately. This panel is behind authentication and invisible to crawlers,
 * so server rendering would buy nothing while adding a server that holds customer
 * session material. As a static SPA it cannot leak one tenant's data into another's
 * rendered HTML, because no rendering happens on our servers at all.
 *
 * It authenticates with our own product through the headless SDK, which is the most
 * honest test of the headless claim: if it is painful here, it is painful for customers.
 */
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2026-09-01",
  typescript: { strict: true, typeCheck: false },
  // Only publishable keys ever reach this bundle.
  runtimeConfig: { public: { idenzyPublishableKey: "", authApiBaseUrl: "" } },
});
