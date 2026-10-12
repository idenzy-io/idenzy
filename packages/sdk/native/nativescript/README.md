# @idenzy/nativescript

Idenzy for NativeScript: carries `@idenzy/native-js` to the native iOS and Android SDKs, where the
session lives, by calling them directly.

```sh
npm install @idenzy/nativescript @idenzy/native-js
```

```ts
import { configure } from "@idenzy/nativescript";

const idenzy = await configure({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" });
await idenzy.restore();
idenzy.subscribe((status) => {}); // "loading" | "signedOut" | "signedIn"
```

The plugin declares the native SDKs in its `platforms/`. Set `minSdkVersion 26` and the
`idenzyRedirectScheme` manifest placeholder in `App_Resources/Android/app.gradle`, and
`platform :ios, '16.0'` in `App_Resources/iOS/Podfile`.

MIT licensed.
