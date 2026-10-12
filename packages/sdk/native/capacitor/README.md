# @idenzy/capacitor

Idenzy for Capacitor: a plugin that carries `@idenzy/native-js` to the native iOS and Android SDKs.
The session lives there rather than in the web view, so the refresh token is in the Keychain or
the Keystore, out of reach of the page's scripts.

```sh
npm install @idenzy/capacitor @idenzy/native-js
npx cap sync
```

```ts
import { configure } from "@idenzy/capacitor";

const idenzy = await configure({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });
await idenzy.restore();
```

- **Android** needs `minSdkVersion = 26` in `variables.gradle`, and the `idenzyRedirectScheme`
  manifest placeholder set to the scheme of your OAuth redirect URI.
- **iOS** resolves the Swift SDK through Swift Package Manager, or through CocoaPods with the
  `IdenzyCapacitor` podspec.

MIT licensed.
