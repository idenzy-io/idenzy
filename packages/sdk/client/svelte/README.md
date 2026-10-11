# @idenzy/svelte

Svelte and SvelteKit bindings for `@idenzy/js`: the session as stores in components, and a
server hook that verifies every request.

```sh
npm install @idenzy/js @idenzy/svelte
```

```ts
// src/hooks.server.ts
import { createIdenzyHandle } from "@idenzy/svelte/server";

export const handle = createIdenzyHandle({ projectId: "prj_...", issuerUrl: "https://auth.acme.com" });
```

```svelte
<script>
  import { Idenzy } from "@idenzy/js";
  import { setIdenzy } from "@idenzy/svelte";

  const { session } = setIdenzy({ client: new Idenzy({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" }) });
</script>
```

MIT licensed.
