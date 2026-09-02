/**
 * Internal operator console (PROJECT.md 10.1, 10.2).
 *
 * Split from the customer dashboard as a blast-radius decision: impersonation, spend
 * caps and tenant suspension are the highest-privilege code we write, and none of it
 * ships in a bundle a customer downloads. It is also a separation-of-duties control
 * (4.13.7).
 *
 * SSR off, and the origin is IAP or VPN gated. Staff accounts require MFA.
 */
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2026-09-01",
  typescript: { strict: true, typeCheck: false },
  runtimeConfig: { public: { managementApiBaseUrl: "" } },
});
