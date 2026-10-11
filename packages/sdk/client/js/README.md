# @idenzy/js

Idenzy's browser SDK. Idenzy ships no sign-in UI: your pages call this client, and it talks
to the auth API and holds the session.

```sh
npm install @idenzy/js
```

```ts
import { Idenzy } from "@idenzy/js";

export const idenzy = new Idenzy({
  publishableKey: "pk_...",
  apiUrl: "https://auth.acme.com", // http is accepted on localhost and *.localhost only
});

await idenzy.restore(); // once, on page load
const result = await idenzy.signIn.withPassword({ email, password });
if (result.status === "mfa_required") {
  await result.challenge.submit({ factor: "totp", code });
}
const token = await idenzy.getToken(); // for your own API, renewed when it needs to be
```

Ways in: `signIn.withPassword`, `withEmailOtp` + `verifyOtp`, `withMagicLink`, `withOAuth`,
`withPasskey`, `anonymously`, and `signUp.withPassword`. Every one answers with a session or
a second factor still owed, never both.

The session travels in `HttpOnly` cookies when your auth domain allows it and in memory
otherwise (`sessionTransport: "auto"`, the default). The refresh token is never exposed on
the session object.

Framework bindings wrap this client: `@idenzy/vue`, `@idenzy/nuxt`.

MIT licensed.
