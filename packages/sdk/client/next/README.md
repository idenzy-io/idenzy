# @idenzy/next

Idenzy on Next.js: the session in Server Components and route handlers, protected routes in
middleware, and the React bindings for the browser.

```sh
npm install @idenzy/js @idenzy/next
```

```ts
// lib/idenzy.ts, server only
import { IdenzyServer } from "@idenzy/next/server";
export const idenzy = new IdenzyServer({ projectId: "prj_...", issuerUrl: "https://auth.acme.com" });

// in a Server Component or route handler
const session = await idenzy.session();
```

```ts
// middleware.ts
import { protectRoutes } from "@idenzy/next/middleware";
import { idenzy } from "./lib/idenzy";

export default protectRoutes({
  idenzy,
  isProtected: (pathname) => pathname.startsWith("/app"),
  signInUrl: "/sign-in",
});
```

Tokens are verified on your server, offline, against your project's published keys. The
client half is `@idenzy/react`, re-exported from `@idenzy/next`.

MIT licensed.
