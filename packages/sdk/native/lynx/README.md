# @idenzy/lynx

Idenzy for Lynx: a native module, `NativeModules.Idenzy`, that carries `@idenzy/native-js` to the
native iOS and Android SDKs, where the session lives.

```sh
npm install @idenzy/lynx @idenzy/native-js
```

Lynx has no autolinking, so the host app adds the module and registers it before its first
`LynxView`:

- **iOS**: the `IdenzyLynx` pod from this package's `ios/`, then
  `config.register(IdenzyLynxModule.self)` on the `LynxConfig`.
- **Android**: `io.idenzy:idenzy-lynx`, then
  `LynxEnv.inst().registerModule("Idenzy", IdenzyLynxModule::class.java)`. `minSdkVersion` 26.

```tsx
import { configure } from "@idenzy/lynx";
import { IdenzyProvider } from "@idenzy/native-js/react";

// Native modules exist on the background thread only, so configure from an effect.
useEffect(() => {
  void configure({ publishableKey: "pk_...", apiUrl: "https://auth.acme.com" }).then(async (idenzy) => {
    setClient(idenzy);
    await idenzy.restore();
  });
}, []);
```

The hooks in `@idenzy/native-js/react` work under ReactLynx, which resolves `react` to its own.

MIT licensed.
