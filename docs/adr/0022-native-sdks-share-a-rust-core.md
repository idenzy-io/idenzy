# ADR-0022: Native SDKs share a Rust core, and every mobile framework is built on two of them

- Status: accepted
- Date: 2026-10-12

## Context

Phase 2 promises Swift, Kotlin, Flutter and React Native SDKs (PROJECT.md 3.3, 14), and the
platforms we are asked about keep growing: Lynx, NativeScript, and the Tier-2 list behind them
(Kotlin Multiplatform, Unity, Godot, Electron, Tauri, Capacitor). PROJECT.md planned to generate
each non-TypeScript client from an OpenAPI document and hand-polish it.

Generation solves the part that is easy to get right. The routes, the request bodies and the
response shapes are a few hundred lines on any platform. What is expensive to get subtly wrong is
the session state machine around them, and every bug in it costs a user their session:

- refresh is single-flight, and callers queued behind a rotation share its outcome, failures
  included, because a refresh token presented twice revokes the family (ADR-0007);
- a rotation whose answer was not observed is never followed by another with the same token;
- renewal is lazy, never timed;
- a sign-in answers with a session or a challenge, and the challenge finishes on the same path
  with the same device name (ADR-0010);
- PKCE on our exchange code, and the verifier survives the app's process being killed while the
  browser is in front;
- error codes are parsed rather than trusted, and a code newer than the app still arrives as one.

Generated clients do not contain any of that. Each platform would hand-write it, in Swift, Kotlin,
Dart and TypeScript for React Native, then again for every Tier-2 platform: the same state machine
five to ten times, maintained by a team of five whose shared language is TypeScript.

## Decision

**One Rust crate, `idenzy-native` (`packages/sdk/native/core`), holds the protocol and the session
state machine, and does no I/O.** It is exported through UniFFI. The network is an `HttpTransport`
trait and the credential store a `SecureStore` trait, both implemented by the platform. The core
contains no HTTP client, no TLS stack and no storage of its own.

**Two native SDKs wrap it: Swift (`packages/sdk/native/apple`) and Kotlin
(`packages/sdk/native/android`).** They are the only code that touches platform APIs: URLSession
and the Keychain, the Android Keystore and an HTTP client, `ASWebAuthenticationSession` and Custom
Tabs, and later passkeys, App Attest and Play Integrity. Each is written once.

**Every cross-platform framework is a thin bridge over those two, never over the core directly.**
Flutter, React Native and Expo, Lynx, NativeScript and Capacitor call the Swift and Kotlin SDKs
through their own native-module mechanism and add an idiomatic surface in Dart or TypeScript. A
framework SDK then inherits the Keychain, the system browser and the refresh rules rather than
reimplementing any of them.

The rejected alternative was binding the core into each framework directly: `flutter_rust_bridge`
for Dart, `uniffi-bindgen-react-native` for JavaScript. It saves one hop, but each framework would
then need its own Keychain, Keystore and browser-session adapters. Those adapters are exactly the
platform code this decision exists to write only twice. Auth calls are a handful per session, so
the extra hop costs nothing anyone can measure.

### What the core decides that the browser client does not

A phone is not a browser tab, and five behaviours differ on purpose.

- **Header mode, always.** There is no cookie jar to negotiate with, so there is no
  `session_transport_unavailable` downgrade and no retry of any kind.
- **The refresh token persists by default.** ADR-0008 keeps it out of web storage because any
  script on the origin can read web storage. The Keychain (`AfterFirstUnlockThisDeviceOnly`) and a
  Keystore-wrapped key are the protected storage that ADR anticipates for mobile, and PROJECT.md
  4.4 requires them. Values are namespaced by publishable key.
- **"Not sent" is distinguished from "lost".** A platform transport reports `NotSent` only when it
  can prove no byte reached the server: offline, DNS failure, connection refused, failed TLS
  handshake. That token was not spent, and the next call presents it again. Everything else is
  `Interrupted`, and ADR-0007 applies: the session ends locally rather than risk re-presenting a
  spent token. On mobile networks this is the difference between losing the session in an
  elevator and losing it only when the answer was actually lost.
- **The unobserved-rotation rule survives the process.** A marker is written to the store before a
  rotation is sent and removed when its answer is observed. If the marker is still there, because
  a caller abandoned the call or the app was swiped away mid-request, the next launch signs in
  again instead of presenting a token that may already be spent. The successor token is stored
  before the marker is removed. A crash between the two therefore costs a sign-in, never a reuse
  detection.
- **Renewal does not trust the device clock.** A token's lifetime is its own `exp - iat`, counted
  from the moment it arrived. The stated expiry is compared with nothing on the device. A phone ten
  minutes fast would otherwise rotate on every call, and one ten minutes slow would present
  expired tokens.

Also deliberate: **unknown enum values are kept, not refused.** Every response enum has an
`Unrecognized` variant, and an error carries its raw code beside it. A browser always loads the
latest SDK; a mobile binary runs against an API newer than itself for years. "Adding an error code
is not a breaking change" (`@idenzy/protocol/errors/codes`) only holds for a binary that cannot be
updated if the binary survives a code it has never seen.

### Keeping two languages from drifting

The enums, the header names, the key prefixes and the channel names are generated from
`@idenzy/protocol` by `tools/native-codegen`. `pnpm native:check` fails CI when the committed copy
is stale, the same contract as `compliance:check` and `examples:check`. The wire structs are
hand-written. Each is a direct transcription of the zod schema its docstring names, and the core's
tests parse fixtures written to those schemas field for field. Loopback is a hand-written copy of
`isLoopbackHost`, tested against the protocol's own cases verbatim.

## Consequences

- **PROJECT.md 7.1 "TypeScript only" is about the authentication architecture, not the SDKs.**
  The server, the workers, the shared packages and the TypeScript SDKs are TypeScript; an SDK for
  another platform is written in that platform's language. 7.1 now says so. What carries over to
  `packages/sdk/native/` is behaviour: validation at the trust boundary, stable codes, short
  docstrings.
- **Rust is a second language for a team whose overlap was TypeScript** (PROJECT.md 14). The
  mitigation is that the core is small, has no I/O and has no async runtime of its own: futures
  are driven by Swift's and Kotlin's executors through UniFFI. Its tests run with `cargo test` in
  under a second, and every refresh rule has a test that fails when the rule is removed. That
  last claim was checked by deleting each rule in turn.
- **Binary size is paid once per architecture.** The release profile optimises for size, and the
  core takes no TLS, no URL or Unicode tables and no runtime. The four encodings it needs (base64url,
  percent-encoding, form decoding, RFC 3339) are written out and tested against their
  specifications' own vectors.
- **One client per project per process.** Two clients over one store rotate one refresh token
  independently, and the second rotation revokes the session. The platform SDKs expose a shared
  instance for this reason. An app extension that shares a Keychain access group with its app
  needs a cross-process lock that does not exist yet; until it does, extensions must not share
  the refresh token.
- **The platform layer drives rotations to completion.** UniFFI does not propagate cancellation,
  but Kotlin drops a cancelled coroutine's future. A rotation dropped mid-flight is correctly
  treated as unobserved, so the Swift and Kotlin SDKs run calls that may rotate in a scope the
  caller's cancellation does not reach. Otherwise leaving a screen would sign the user out.
- **Open decision 16.8 is resolved: native code is developed here.** One change can touch the
  protocol, the core and both SDKs and be reviewed as one. Maven Central and pub.dev publish from a
  subdirectory. Swift Package Manager needs `Package.swift` at a repository root, so release CI
  mirrors `packages/sdk/native/apple` and the built XCFramework into a thin `idenzy-swift`
  repository. That mirror is release plumbing and is deferred with the rest of it.
- **Not in the core yet, each with a reason:**
  - Passkeys: the ceremony is a platform API between two round trips, and the API must first serve
    `apple-app-site-association` and `assetlinks.json` on the auth domain.
  - App Attest and Play Integrity: Phase 3. `start_sms` already carries the attestation header.
- The SDKs are MIT, as every SDK is. The server's AGPL does not reach an app built on them.
