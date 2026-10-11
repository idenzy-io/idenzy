# @idenzy/solid

Solid bindings for `@idenzy/js`: `IdenzyProvider`, and `useIdenzy()`, `useSession()` and
`useUser()`.

```sh
npm install @idenzy/js @idenzy/solid
```

```tsx
import { Idenzy } from "@idenzy/js";
import { IdenzyProvider, useSession } from "@idenzy/solid";

const client = new Idenzy({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });

render(() => <IdenzyProvider client={client}><App /></IdenzyProvider>, root);

const session = useSession(); // an accessor: session().status
```

MIT licensed.
