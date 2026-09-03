# Idenzy starter: SvelteKit

Working sign-in, sign-up, one-time code and OAuth routes, written in this framework's own
idiom. Copy them into your application, or have the CLI write them for you:

```bash
npx idenzy init --framework sveltekit
```

Idenzy ships no authentication UI, so none of this is a component of ours: it is ordinary
application code that calls the SDK. It is yours the moment you copy it. Restyle it, rename
the routes, delete what you do not use, and there is nothing here to keep in step with our
releases.

Every message a user reads comes from `auth-errors`, which maps our stable error codes to
your copy. The codes are the API; the sentences are yours.

## Getting there

1. Install the SDK: npm install @idenzy/svelte @idenzy/js
2. Declare the handle's answer in src/app.d.ts: import type { IdenzyServerSession } from "@idenzy/svelte/server", then add idenzy: IdenzyServerSession to App.Locals.
3. If you already had src/hooks.server.ts or a root layout, this kept yours. Merge the scaffolded version by hand: the handle has to run, and the layout has to call setIdenzy.
4. Register http://localhost:5173/auth/callback as a redirect URI, and http://localhost:5173 as a browser origin, for this project.
5. Everything under src/routes is yours now. Restyle it, rename it, delete what you do not use.

Environment variables are listed in `.env.example`. Copy it to `.env`.

---

Generated from the `sveltekit` template in `@idenzy/cli`. Change the template, then run
`pnpm examples:generate`; CI fails if these files and that template disagree.
