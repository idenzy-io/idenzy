# @idenzy/react-native

Idenzy for React Native and Expo: an Expo module that carries `@idenzy/native-js` to the native iOS
and Android SDKs, where the session lives.

```sh
npx expo install @idenzy/react-native @idenzy/native-js
```

```tsx
import { IdenzyProvider, useIdenzyStatus } from "@idenzy/native-js/react";
import { configure } from "@idenzy/react-native";

const idenzy = await configure({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });
await idenzy.restore();

<IdenzyProvider client={idenzy}><App /></IdenzyProvider>;
const status = useIdenzyStatus(); // "loading" | "signedOut" | "signedIn"
```

Configure one project per app: a second publishable key is refused, because every handle reaches
the same native client.

- **Android** needs `minSdkVersion` 26, and the `idenzyRedirectScheme` manifest placeholder set to
  the scheme of your OAuth redirect URI.
- **Sign in with Apple** needs the capability on the iOS app and its bundle ID on the project's
  Apple provider. **Passkeys** need your domain to vouch for the app: `webcredentials` in its
  `apple-app-site-association`, and the app's package and signing certificate in its
  `assetlinks.json`, with the app's origin added to the project's passkey settings.

MIT licensed.
