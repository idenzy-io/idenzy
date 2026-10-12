# The native SDKs

The Rust core, the Swift and Kotlin SDKs on top of it, and the build that joins them. Read
ADR-0022 first: it says why there is a Rust core at all, and why every mobile framework is meant
to be a bridge over the two native SDKs rather than another binding of the core.

```
packages/sdk/native/
├── core/             idenzy-native: the protocol and the session state machine. No I/O.
├── uniffi-bindgen/   the generator, pinned to the core's UniFFI version
├── apple/            Swift package `Idenzy`: URLSession, the Keychain, ASWebAuthenticationSession
├── android/          Gradle library `io.idenzy`: HttpURLConnection, the Keystore, Custom Tabs,
│                     Credential Manager
├── flutter/
│   └── idenzy_flutter/  the Flutter plugin, over the two SDKs above
├── js/               @idenzy/native-js: the JavaScript client React Native, Lynx and NativeScript share
├── react-native/     @idenzy/react-native: an Expo module carrying it
├── lynx/             @idenzy/lynx: a Lynx native module carrying it
└── scripts/          build-apple.sh, build-android.sh
```

```bash
cd packages/sdk/native
cargo test                                   # the core, in under a second
scripts/build-apple.sh --dev && (cd apple && swift test)
scripts/build-android.sh --dev && (cd android && ./gradlew :idenzy:testDebugUnitTest)
scripts/build-apple.sh                       # release XCFramework: iOS, simulator, macOS
scripts/build-android.sh                     # release jniLibs for four ABIs
pnpm native:generate                         # from the repo root, after a protocol enum changes
```

The generated bindings, the XCFramework and the `jniLibs` are build output and are not
committed. Run the script for a platform before opening its project.

## Working on the core

- **It does no I/O, and it stays that way.** The network is `HttpTransport` and the store is
  `SecureStore`, both implemented by the platform. A dependency that brings an HTTP client, a TLS
  stack or an async runtime is the wrong one. Futures are driven by Swift's and Kotlin's
  executors through UniFFI, so anything tied to tokio would not run.
- **The refresh rules are the reason the crate exists.** One rotation at a time, and waiters
  share its outcome, failures included. A rotation whose answer was not observed is never
  followed by another. Renewal is lazy. Each rule has a test in `tests/refresh.rs` that fails
  when the rule is removed, and that was checked by removing them. Keep it that way: a new
  rule gets a test, and the test gets checked against a copy with the rule deleted.
- **The rotation marker is the unobserved-answer rule, not a cache.** It is written to the store
  before the request goes out and removed only after the answer is observed. It covers a caller
  that abandoned the call and a process that died mid-request with the same mechanism. Two
  orderings matter. The successor token is stored before the marker is removed. Epoch checks and
  token reads share the state lock that an adoption holds while it writes its token.
- **Every response enum ends in `Unrecognized`.** A mobile binary runs against a newer API for
  years. An unknown error code arrives as `ErrorCode::Unrecognized` with `raw_code` beside it,
  never as a parse failure that turns a refusal into a transport error.
- **Wire structs are hand-written transcriptions of zod schemas.** Each docstring names its
  schema, and the fixtures in `testing.rs` are written to them field for field. Unknown fields
  are ignored, as zod strips them. Enums, header names, key prefixes and channels are not
  hand-written: they are generated (below).
- **Loopback is `isLoopbackHost`, copied.** `config.rs` runs the protocol's own test cases
  verbatim. Change one and you change both.
- **Error fields are called `detail`, never `message`.** Kotlin makes every error an exception,
  and a field named `message` collides with `Throwable.message`. The generated code does not
  compile.
- **No `PATCH`.** Android's `HttpURLConnection` cannot send it. If an endpoint ever needs one,
  the Android transport needs a different client first.

### Adding an endpoint

Add a method to the flow or API object it belongs to, built on `Call` and the `SessionFlow` it
holds. A call that ends in a session goes through `establish`, never through `send` plus an
adoption by hand. A call that needs a session takes its token from `require_token`, which is
what can rotate. Then wrap it in both SDKs. The Kotlin wrapper must go through `shielded`
(below).

### Adding an error code

`pnpm native:generate` after the protocol change, and commit `core/src/protocol/generated.rs`.
CI runs `pnpm native:check`. Nothing else is needed: the new code arrives as itself in a build
that has it, and as `Unrecognized` in one that does not.

## Working on a platform SDK

- **A transport reports `NotSent` only with proof.** Offline, no DNS answer, connection refused,
  or a TLS handshake that failed before the request was written. Everything else, a timeout
  included, is `Interrupted`. Calling a lost answer `NotSent` lets the core present a refresh
  token the server may already have rotated, which revokes the session. Both transports have a
  test for the classification, and it is the test to read before changing one.
- **A transport must not follow redirects, keep cookies, cache, or retry.** URLSession is
  ephemeral with a delegate that refuses redirects. `HttpURLConnection` is buffered rather than
  streamed. In streaming mode the JDK hands back a 401 with no readable body, and the 401 that
  matters most is a refused refresh: read as an unexpected response, it keeps a session the
  server has already ended. `HttpUrlConnectionTransportTest` caught exactly that.
- **One client per project per process.** `Idenzy.shared` on both platforms, refusing a second
  configuration for the same key with a different URL. Two clients over one store rotate one
  token twice.
- **Kotlin shields every call, Swift does not need to.** UniFFI's Kotlin bindings drop the Rust
  future when the calling coroutine is cancelled. A rotation dropped mid-flight is correctly
  treated as unobserved, and the session ends. So every method on the Kotlin `Idenzy` runs in
  the client's own scope (`shielded`), and the core client is not exposed. `IdenzyTest` has the
  test and its control: the same cancellation against the core directly ends the session. Swift's
  bindings never cancel a Rust future, so a cancelled `Task` simply stops waiting.
- **`status` starts at loading and stays there until `restore` knows.** A signed-out report from
  the core before then means "nothing held yet". A `restore` that cannot reach us, or cannot read
  a Keychain locked since boot, throws and leaves the status loading with the token kept. That is
  what an offline launch is.
- **The Keychain item is `AfterFirstUnlockThisDeviceOnly`, and a reinstall forgets it.** Items
  outlive the app on iOS. `KeychainStore` wipes its service on the first launch of an install,
  keyed by a `UserDefaults` flag that uninstalling deletes.
- **The Android store commits.** `SharedPreferences.apply` reports success before the value is
  on disk, and the core stores a rotated token before it does anything else. A value the
  Keystore cannot open (restored from a backup onto another device, or tampered with) reads as
  absent and is removed.

### Traps in the build

- **macOS ships bash 3.2.** No associative arrays and no `\s` in `sed`; the scripts avoid both.
- **Cargo's debug profile is called `dev`.** `--profile debug` is refused; the output directory is
  still `target/<triple>/debug`.
- **SwiftPM test bundles have no keychain entitlement**, on macOS or in the simulator, so the
  data-protection keychain refuses them. `KeychainStoreTests` run against the macOS file keychain
  through an internal initialiser. On iOS they skip, because there is no app to host them.
- **AGP 9 compiles Kotlin itself, with Kotlin 2.2.** `googleid` 1.2.1 is compiled with 2.4 and
  an older compiler cannot read it, so the root build script puts KGP 2.4 on the classpath, and
  that replaces it. There is no `org.jetbrains.kotlin.android` plugin to apply: Kotlin is built
  into AGP 9.
- **The library is written for Kotlin 2.1 whatever compiles it.** `languageVersion` and
  `apiVersion` are 2.1 and the stdlib dependency is 2.1.20 (`kotlin-floor`), with coroutines held
  at 1.10.2 to match. React Native's Android build is on Kotlin 2.1, and it can read neither 2.4
  metadata nor a 2.4 stdlib: every class of ours fails to resolve. Raise the floor only with the
  oldest framework it would leave behind in view.
- **Unit tests load the host build of the core** from `android/idenzy/build/host-native` through
  JNA, and `unitTests.isReturnDefaultValues` lets the generated code's `Build.VERSION` check fall
  back to JNA's cleaner on the JVM.
- **The Android libraries are linked for 16 KB pages.** Google Play refuses 4 KB alignment for new
  apps. `llvm-readelf -lW` shows `0x4000` on every `LOAD` segment.

## Native Sign in with Apple and Google

The platform's own sheet, then `IdTokenFlow` in the core: `prepare` fetches a nonce from the API
and returns it with its SHA-256, the sheet signs the digest into the ID token, and `exchange`
sends the token with the nonce. The backend half is in backend.md.

- **The digest goes to the sheet, the nonce to the API, and never the other way round.** A token
  copied off the device carries only the digest, which is what makes it worthless to whoever
  copied it. Every SDK has a test asserting the digest is not in the exchange body.
- **Apple is native on Apple platforms only, Google on Android only.** `signInWithApple` drives
  `ASAuthorizationController`; `signInWithGoogle` drives Credential Manager with
  `GetSignInWithGoogleOption` and the project's web client id. Google on iOS needs Google's own
  SDK, which we do not bundle: `prepareNativeSignIn` and `exchangeIdToken` are the seam it uses.
  Apple on Android is the OAuth flow through Custom Tabs.
- **A dismissed sheet is the platform's own cancel error, untranslated** (`ASAuthorizationError
  .canceled`, `GetCredentialCancellationException`), as a dismissed browser is. The bridges map
  each to `cancelled`.

## Working on the Flutter plugin

`flutter/idenzy_flutter`: Dart over a method channel, with a Swift and a Kotlin plugin class that
call the native SDKs and decide nothing. The enums in `lib/src/generated/protocol.dart` come from
`pnpm native:generate` like the core's, and the plugins read wire strings from the core's
generated `wire_*` functions rather than keeping tables of their own.

```bash
scripts/build-apple.sh                                   # every slice: the plugin builds for iOS
scripts/build-android.sh && (cd android && ./gradlew :idenzy:publishToMavenLocal)
cd flutter/idenzy_flutter && flutter analyze && flutter test
cd example && flutter test integration_test -d <simulator or emulator> --no-dds
```

- **The package is `idenzy_flutter`, and the name is load-bearing twice.** Flutter links a plugin
  into the app's Swift packages under its directory name, and SwiftPM takes the identity from it,
  so the directory and the package name must match. And a plugin target called `idenzy` beside
  the Swift SDK's module `Idenzy` builds into one directory on a case-insensitive disk, where each
  overwrites the other. Both surface as Xcode errors that name neither cause.
- **The plugin's `Package.swift` finds the Swift SDK from its real location.** Flutter reaches it
  through a symlink, so a relative path resolves from the app's ephemeral directory; the manifest
  resolves `#filePath` through the symlink first. Publishing replaces this with a versioned
  package.
- **The plugin's Android build declares the AGP and Kotlin versions Flutter's template does.**
  The app's AGP wins, and a different one in the plugin's `buildscript` loads twice and fails with
  a class-cast error between two copies of the same class.
- **An app finds the Android SDK in `mavenLocal()` until it is published.** The example declares
  it, with the comment that says why.
- **Android refuses cleartext before connecting, and the transport asks first.** The refusal
  arrives as a plain `IOException`, indistinguishable from a lost answer, so
  `HttpUrlConnectionTransport` checks `NetworkSecurityPolicy` itself and reports `NotSent`. The
  example's debug build allows `127.0.0.1` and `localhost` and nothing else. Found by running the
  integration test on an emulator, which is why that test exists.
- **`--no-dds` on this machine's Flutter**, whose development service fails to start. The
  integration runner then logs one error from the golden-file comparator it cannot subscribe;
  the tests themselves are what to read.

## The bridge every framework plugin sits on

`IdenzyBridge` (Swift product `IdenzyBridge`, Kotlin `io.idenzy.bridge`) is the native SDK as one
method table over plain values: `call("password.signIn", ["email": …])` in, a dictionary of strings,
numbers and booleans out, and a `BridgeFailure(code, message, details)` for anything refused. The
Flutter plugin, the React Native module and the Lynx module are message carriers over it, and
NativeScript and Capacitor will be too.

- **A new method goes in the bridge, once per platform, and nowhere else.** Then the Dart client
  and `@idenzy/native-js` each get one line that names it. A plugin that maps values itself is
  another copy of the table, which is the thing the bridge exists to prevent.
- **Timestamps cross as milliseconds, enums as their wire values** (from the core's generated
  `wire_*` functions), errors as the API's raw code with `status`, `requestId`,
  `retryAfterSeconds`, `fields` and `transportReason` beside it.
- **`answer` is `call` for JavaScript**: `{ ok }` or `{ error: { code, message, details } }`, never
  a throw, because a framework's own exception carries a code and a message at best and a screen
  needs the rest. Every JavaScript carrier returns it as it is.
- **`IDZBridge` is the bridge for Objective-C**, which Lynx's module has to be written in and
  NativeScript reaches everything through. Main thread only, like the bridge; the caller hops.
- **A bridge serves one project for the life of the process.** Every handle a framework holds
  reaches the bridge's one client, and every status watch is bound to it, so `configure` with a
  second publishable key is refused rather than quietly taking them all over. The same key again,
  as a hot reload sends it, is answered with the client already there.
- **Both bridges have tests of their own** (`IdenzyBridgeTests`, `IdenzyBridgeTest`) against fakes:
  a value shape, a refusal, a missing argument, an unknown method, a second project, an answer.

## The JavaScript client

`js/`: `@idenzy/native-js`, the client a JavaScript app on the native SDKs holds, whichever
framework it is written in. It turns calls into bridge messages and answers into types, with error
codes from `@idenzy/protocol` directly, and decides nothing about the session. React Native, Lynx
and NativeScript differ only in how they reach native code, so each of their packages is a
`configure` that supplies a `NativeBridge` (a `call` and a `watchStatus`), and this is the rest.

- **An app imports from two packages**, the way a web app takes `@idenzy/js` and `@idenzy/react`:
  `configure` from its framework's, and the `Idenzy` type, `/errors`, `/types` and the `/react`
  hooks from this one. Re-exporting them from each framework package would be a barrel per
  framework, which Biome refuses (PROJECT.md 7.5).
- **The hooks are written against `react` and serve ReactLynx too.** ReactLynx aliases `react` to
  `@lynx-js/react`, `useSyncExternalStore` included, so the Lynx example renders through the same
  `IdenzyProvider` as React Native. `react` is an optional peer for that reason.

## Working on the React Native package

`react-native/`: `@idenzy/react-native`, an Expo module (Swift and Kotlin, a few lines each) over
the bridge, and `configure`, which hands the shared client the module as its `NativeBridge`. It is
in the pnpm workspace and held to the same TypeScript rules as every other SDK; the example app is
not, and installs with npm.

```bash
pnpm turbo run typecheck test build --filter=@idenzy/native-js --filter=@idenzy/react-native
(cd android && ./gradlew :idenzy:publishToMavenLocal)   # the module's Android dependency
cd react-native/example && npm install && npx expo prebuild --clean --no-install
(cd ios && bundle install && bundle exec pod install)   # see the CocoaPods trap below
xcodebuild -workspace ios/IdenzyExample.xcworkspace -scheme IdenzyExample -sdk iphonesimulator …
(cd android && ./gradlew assembleDebug)
```

- **`expo-modules-core` is declared, not installed,** and loaded lazily inside `configure`, so the
  tests pass a fake module and React Native never enters the workspace's lockfile.
- **Three Swift pods for three modules.** React Native links CocoaPods, not Swift packages, so
  `apple/` carries `IdenzyCore`, `Idenzy` and `IdenzyBridge` podspecs: one pod per module keeps
  every `import` the sources make. Until they are on trunk, an app names them by path; the example
  does it with `expo-build-properties`' `ios.extraPods`, computed in `app.config.ts`.
- **Metro watches three directories outside the example and not the workspace root.** It resolves
  only files it watches, which is what keeps `react` from `../../js` on the app's copy rather than
  the workspace's development one under `node_modules/.pnpm`. With the root watched, both are
  bundled (checked: React 19.2.0 and 19.2.8 side by side), and two Reacts fail every hook.
- **An app named `Idenzy` collides with the `Idenzy` pod.** Its Xcode target takes the name.
- **Expo's SDK sets a floor on Xcode.** Expo 56 and 57 compile `expo-modules-jsi`, which uses
  `weak let` and needs a Swift newer than the one in Xcode 26.0; Expo 55 does not. The example is
  on 55 for that reason, and the module itself has no such floor.
- **A globally installed `json` 3 breaks Homebrew's CocoaPods.** ActiveSupport 7.2 still passes
  `quirks_mode`, which json 3 removed, and every `pod install` ends in an `ArgumentError`. The
  example pins CocoaPods and `json < 3` in its own Gemfile; use `bundle exec pod install` with
  Homebrew's Ruby first on the `PATH`, since the system Ruby's bundler is too old for the lock.
- **The example runs a device self-test instead of itself when built with
  `EXPO_PUBLIC_IDENZY_SELF_TEST=1`**: a secret key refused, a fresh install signed out, an
  unreachable API reported as never reached, a second project refused, and the hooks rendering the
  status, ending in one `IDENZY_SELF_TEST PASS` or `FAIL …` line. The secret key goes first: once a
  project is configured, any other key is refused for that reason and the check would pass for the
  wrong one. Build Release, so Metro inlines the variable into the bundle rather than a dev server
  serving it. The line goes through `console.error`, because a release build forwards nothing
  quieter to the device log; read it with `adb logcat -d | grep IDENZY_SELF_TEST`, or on the
  simulator with `xcrun simctl spawn booted log show --last 5m --predicate 'process ==
  "IdenzyExample"' | grep IDENZY_SELF_TEST`. Gradle also needs `ANDROID_HOME` in its environment;
  the prebuilt project has no `local.properties`.

## Working on the Lynx package

`lynx/`: `@idenzy/lynx`, a Lynx native module named `Idenzy` (Objective-C on iOS, Kotlin on
Android), and `configure`, which hands the shared client the module and `GlobalEventEmitter` as
its `NativeBridge`. Lynx has no autolinking: an app adds the module's pod or AAR and registers it
itself, before its first `LynxView`.

```bash
pnpm turbo run typecheck test build --filter=@idenzy/lynx
(cd android && ./gradlew :idenzy:publishToMavenLocal :idenzy-lynx:publishToMavenLocal)
cd lynx/example && npm install && npm run build          # dist/main.lynx.bundle, the page
(cd ios && bundle install && bundle exec pod install)    # Homebrew's Ruby first on the PATH
xcodebuild -workspace ios/IdenzyLynxExample.xcworkspace -scheme IdenzyLynxExample -sdk iphonesimulator …
(cd android && ./gradlew :app:assembleDebug)
```

- **The iOS module is Objective-C** because Lynx defines no Clang module, so a Swift pod cannot
  `import Lynx`. It reaches the bridge through `IDZBridge`, hopping from Lynx's JavaScript thread to
  the main one.
- **The Android module is built in the SDK's Gradle build**, as `:idenzy-lynx` with its sources in
  `lynx/android`, so it compiles against the SDK as it is and is emitted for the same Kotlin floor.
  It depends on Lynx `compileOnly`: the app brings its own.
- **Every `Long` crosses as a `Double` on Android.** Lynx maps a JavaScript number to `double` and
  a `long` to a BigInt, and a millisecond timestamp is a number on the other side. `LynxValueTest`
  holds that.
- **The status is a global event, `idenzy:status`.** The module gets its `LynxContext` by being a
  `LynxContextModule` and sends each status with `sendGlobalEvent`; the client listens before it
  asks the module to start, so the first one is never missed.
- **Native modules exist only on the background thread.** `configure` belongs in a `useEffect`,
  and outside a Lynx page it refuses with `validation_failed` rather than failing on a missing
  global.
- **The example's hosts started from Lynx's own `integrating-lynx-demo-projects`** (Apache-2.0),
  cut down to one `LynxView`. They read the page from `dist/`, so build it first, and the same
  self-test as React Native's runs as the page itself, logged and drawn on screen. On Android the
  line is in `adb logcat` under the `lynx` tag, with the log service registered. On iOS the page's
  console reaches no log at all, Lynx's own lines do, so read it from the screen: `xcrun simctl io
  booted screenshot`.

## Not built yet

Passkeys (needs `apple-app-site-association` and `assetlinks.json` served by the auth domain),
App Attest and Play Integrity, the Swift Package Manager mirror and Maven publishing, and the
NativeScript and Capacitor bridges.
