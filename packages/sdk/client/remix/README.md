# @idenzy/remix

Remix helpers for Idenzy: who a request is from, verified on your server, for loaders and
actions.

```sh
npm install @idenzy/js @idenzy/remix
```

```ts
// app/idenzy.server.ts
import { IdenzyServer } from "@idenzy/remix/server";
export const idenzy = new IdenzyServer({ projectId: "prj_...", issuerUrl: "https://auth.acme.com" });

// in a loader or an action
const session = await idenzy.sessionFor(request);
```

Tokens are verified offline against your project's published keys; nothing on the request
path calls us.

MIT licensed.
