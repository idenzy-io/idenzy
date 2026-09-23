import { fileURLToPath } from "node:url";

/*
 * The repository's one `.env`, for the operator values below. The dashboard's publishable key is
 * in the same file under the name `@idenzy/nuxt` reads (`NUXT_PUBLIC_IDENZY_PUBLISHABLE_KEY`), and
 * left in the environment it would override this app's at runtime and sign operators in to the
 * dashboard project, whose tokens the operator API refuses. So it is taken out of this process's
 * environment once the operator key has been read.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env: the values fall back to the defaults below, and the console says it cannot sign in.
}
const operatorKey = process.env["NUXT_PUBLIC_OPERATOR_PUBLISHABLE_KEY"] ?? "";
delete process.env["NUXT_PUBLIC_IDENZY_PUBLISHABLE_KEY"];

/**
 * Internal operator console (PROJECT.md 10.1, 10.2; ADR-0018).
 *
 * Split from the customer dashboard as a blast-radius decision: operator tooling is the
 * highest-privilege code we write, and none of it ships in a bundle a customer downloads. It is
 * also a separation-of-duties control (4.13.7).
 *
 * SSR off, and in production the origin is IAP or VPN gated. Staff sign in with Google, to the
 * operator project, and only idenzy.io Workspace accounts that are on the staff list get past the
 * API — Workspace's own 2-step verification is the second factor.
 *
 * `sessionTransport: "header"`: the session lives in this tab's memory and ends with it. Locally
 * the dashboard and the console share one auth host, and cookie mode would have their sessions
 * overwrite each other's cookies; for a console this privileged, a session that does not outlive
 * the tab is the right default anyway.
 */
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2026-09-01",
  typescript: { strict: true, typeCheck: false },
  devServer: { port: 3004 },

  idenzy: {
    publishableKey: operatorKey,
    apiUrl: "http://localhost:3001",
    sessionTransport: "header",
  },

  modules: ["@idenzy/nuxt", "@vueuse/nuxt"],
});
