# @idenzy/react

React bindings for `@idenzy/js`: `IdenzyProvider`, and `useIdenzy()`, `useSession()` and `useUser()`.

```sh
npm install @idenzy/js @idenzy/react
```

```tsx
import { Idenzy } from "@idenzy/js";
import { IdenzyProvider, useSession } from "@idenzy/react";

// Built once, outside the tree: one client per page.
const client = new Idenzy({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });

root.render(<IdenzyProvider client={client}><App /></IdenzyProvider>);

const session = useSession(); // { status: "loading" | "signed-in" | "signed-out", ... }
```

`loading` is a real third state: render neither the signed-in nor the signed-out view while it
holds. On Next.js, use `@idenzy/next`.

MIT licensed.
