# @idenzy/astro

Astro middleware for Idenzy: every request's session, verified on your server, in
`Astro.locals`.

```sh
npm install @idenzy/js @idenzy/astro
```

```ts
// src/middleware.ts
import { createIdenzyMiddleware } from "@idenzy/astro";

export const onRequest = createIdenzyMiddleware({ projectId: "prj_...", issuerUrl: "https://auth.acme.com" });
```

Tokens are verified offline against your project's published keys; nothing on the request
path calls us.

MIT licensed.
