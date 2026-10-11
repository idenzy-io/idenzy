# @idenzy/angular

Angular bindings for `@idenzy/js`: `provideIdenzy()` and an injectable `IdenzySession`.

```sh
npm install @idenzy/js @idenzy/angular
```

```ts
import { Idenzy } from "@idenzy/js";
import { provideIdenzy } from "@idenzy/angular";

const client = new Idenzy({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });

bootstrapApplication(AppComponent, { providers: [provideIdenzy({ client })] });
```

Inject `IdenzySession` and read its `status` (`loading`, `signed-in` or `signed-out`)
rather than testing the user for null: `loading` lasts until the first restore answers.

MIT licensed.
