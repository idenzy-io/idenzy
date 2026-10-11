# Idenzy starter: Next.js (App Router)

Working sign-in, sign-up, one-time code and OAuth routes, written in this framework's own
idiom. Copy them into your application, or have the CLI write them for you:

```bash
npx @idenzy/cli init --framework next
```

Idenzy ships no authentication UI, so none of this is a component of ours: it is ordinary
application code that calls the SDK. It is yours the moment you copy it. Restyle it, rename
the routes, delete what you do not use, and there is nothing here to keep in step with our
releases.

Every message a user reads comes from `auth-errors`, which maps our stable error codes to
your copy. The codes are the API; the sentences are yours.

## Getting there

1. Install the SDK: npm install @idenzy/next @idenzy/js
2. Wrap your tree in app/layout.tsx: const session = await idenzyServer.session(), then <Providers initialSession={session}>{children}</Providers>. Pass the seed through even when it is null.
3. Register http://localhost:3000/auth/callback as a redirect URI, and http://localhost:3000 as a browser origin, for this project.
4. Fill IDENZY_PROJECT_ID in .env.local. The publishable key belongs in the browser; the project id and the secret key do not.
5. Everything under app/ is yours now. Restyle it, rename the routes, delete what you do not use.

Environment variables are listed in `.env.example`. Copy it to `.env.local`.

---

Generated from the `next` template in `@idenzy/cli`. Change the template, then run
`pnpm examples:generate`; CI fails if these files and that template disagree.
