# @idenzy/vue

Vue bindings for `@idenzy/js`: a plugin, and `useIdenzy()`, `useSession()` and `useUser()`.

```sh
npm install @idenzy/js @idenzy/vue
```

```ts
import { Idenzy } from "@idenzy/js";
import { createIdenzy } from "@idenzy/vue";

const client = new Idenzy({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });
app.use(createIdenzy({ client }));
```

```ts
const session = useSession(); // { status: "loading" | "signed-in" | "signed-out", ... }
```

`loading` is a real third state: it lasts until the first restore answers, so render
neither the signed-in nor the signed-out view while it holds. On Nuxt, use `@idenzy/nuxt`.

MIT licensed.
