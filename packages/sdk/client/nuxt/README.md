# @idenzy/nuxt

The Nuxt module for Idenzy: the Vue bindings registered for you, `useIdenzy()`,
`useSession()` and `useUser()` auto-imported, and a server render seeded from the session
cookie so a signed-in page costs no round trip.

```sh
npm install @idenzy/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@idenzy/nuxt"],
  idenzy: {
    publishableKey: "", // NUXT_PUBLIC_IDENZY_PUBLISHABLE_KEY
    apiUrl: "", //         NUXT_PUBLIC_IDENZY_API_URL
    projectId: "", //      NUXT_PUBLIC_IDENZY_PROJECT_ID, for the server-rendered seed
  },
});
```

The module adds no pages and no middleware: where a signed-out visitor goes is your
application's decision. A guard is a few lines of your own:

```ts
// middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith("/auth/")) return;
  const session = useSession();
  if (session.value.status === "loading") {
    await new Promise<void>((resolve) => {
      const stop = watch(session, (now) => {
        if (now.status === "loading") return;
        stop();
        resolve();
      });
    });
  }
  if (session.value.status !== "signed-in") {
    return navigateTo({ path: "/auth/login", query: { redirect: to.fullPath } });
  }
});
```

With `ssr: false` the session is restored in the browser. With server rendering, the
server verifies the session cookie and the page hydrates from that answer; set
`NUXT_IDENZY_SECRET_KEY` (server-only, never `public`) to also refuse revoked sessions.

MIT licensed.
