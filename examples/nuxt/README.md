# Idenzy starter: Nuxt

Working sign-in, sign-up, one-time code and OAuth routes, written in this framework's own
idiom. Copy them into your application, or have the CLI write them for you:

```bash
npx idenzy init --framework nuxt
```

Idenzy ships no authentication UI, so none of this is a component of ours: it is ordinary
application code that calls the SDK. It is yours the moment you copy it. Restyle it, rename
the routes, delete what you do not use, and there is nothing here to keep in step with our
releases.

Every message a user reads comes from `auth-errors`, which maps our stable error codes to
your copy. The codes are the API; the sentences are yours.

## Getting there

1. Install the SDK: npm install @idenzy/nuxt @idenzy/js
2. Add the module in nuxt.config.ts: modules: ["@idenzy/nuxt"], idenzy: { publishableKey: "", apiUrl: "" }. Leave both empty and let the environment fill them: Nuxt only overrides runtime config keys that already exist, so a key left out of the config is one the env var is silently discarded for.
3. Register http://localhost:3000/auth/callback as a redirect URI, and http://localhost:3000 as a browser origin, for this project.
4. Optional: set NUXT_IDENZY_SECRET_KEY to have the server poll the revocation set, so a session revoked minutes ago is refused before its access token expires. It is server-only and must never reach the public half of runtime config.
5. Everything under app/ is yours now. Restyle it, rename the routes, delete what you do not use.

Environment variables are listed in `.env.example`. Copy it to `.env`.

---

Generated from the `nuxt` template in `@idenzy/cli`. Change the template, then run
`pnpm examples:generate`; CI fails if these files and that template disagree.
