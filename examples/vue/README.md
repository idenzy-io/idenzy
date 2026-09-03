# Idenzy starter: Vue (Vite)

Working sign-in, sign-up, one-time code and OAuth routes, written in this framework's own
idiom. Copy them into your application, or have the CLI write them for you:

```bash
npx idenzy init --framework vue
```

Idenzy ships no authentication UI, so none of this is a component of ours: it is ordinary
application code that calls the SDK. It is yours the moment you copy it. Restyle it, rename
the routes, delete what you do not use, and there is nothing here to keep in step with our
releases.

Every message a user reads comes from `auth-errors`, which maps our stable error codes to
your copy. The codes are the API; the sentences are yours.

## Getting there

1. Install the SDK: npm install @idenzy/vue @idenzy/js
2. Install the plugin in src/main.ts: app.use(createIdenzy({ client: idenzy })), importing createIdenzy from "@idenzy/vue" and idenzy from "./idenzy".
3. Route /auth/callback to OAuthCallback.vue, however your application does routing.
4. Register http://localhost:5173/auth/callback as a redirect URI, and http://localhost:5173 as a browser origin, for this project.
5. Everything under src/auth is yours now. Restyle it, rename it, delete what you do not use.

Environment variables are listed in `.env.example`. Copy it to `.env`.

---

Generated from the `vue` template in `@idenzy/cli`. Change the template, then run
`pnpm examples:generate`; CI fails if these files and that template disagree.
