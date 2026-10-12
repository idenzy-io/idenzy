# @idenzy/native-js

The client a JavaScript app on Idenzy's native iOS and Android SDKs holds, whichever framework it
is written in. You install it beside your framework's package, which supplies `configure`:
`@idenzy/react-native`, `@idenzy/lynx`, `@idenzy/nativescript` or `@idenzy/capacitor`.

The session is held by the native SDKs, not in JavaScript: the refresh token is in the Keychain on
iOS and under a Keystore key on Android, and refreshing follows the same rules on both. This
package turns calls into messages and answers into types. Idenzy ships no authentication UI, so
every screen is yours.

```ts
import type { Idenzy } from "@idenzy/native-js";
import { IdenzyError } from "@idenzy/native-js/errors";

await idenzy.restore(); // once, at start-up; the status stays "loading" until it answers

await idenzy.signIn.withEmailOtp({ email });
const result = await idenzy.signIn.verifyOtp({ code });
if (result.status === "mfa_required") {
  await result.challenge.submit({ factor: "totp", code: totpCode });
}

const token = await idenzy.getToken(); // for your own API calls
idenzy.subscribe((status) => {}); // "loading" | "signedOut" | "signedIn"
```

Errors are `IdenzyError`, with the API's stable `code` beside the HTTP status, the request id and
any field details. A closed sign-in sheet is `IdenzySignInCancelled`.

React hooks, which ReactLynx can use too, are in `@idenzy/native-js/react`: `IdenzyProvider`,
`useIdenzy`, `useIdenzyStatus` and `useUser`.

MIT licensed.
