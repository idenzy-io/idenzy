# idenzy_flutter

Idenzy for Flutter: sign-in, sessions and MFA over the native iOS and Android SDKs.

Idenzy ships no authentication UI. Every screen is yours, built from the values and the stable
error codes this package returns. The session itself is held by the native SDKs underneath:
the refresh token is in the Keychain on iOS and under a Keystore key on Android, and refreshing
follows the same rules on both.

```dart
final idenzy = await Idenzy.configure(publishableKey: 'pk_live_…', apiUrl: 'https://auth.example.com');
await idenzy.restore();                       // once, at start-up

await idenzy.signIn.withEmailOtp(email: email);
final result = await idenzy.signIn.verifyOtp(code: code);
switch (result) {
  case Authenticated(:final session): /* signed in */
  case MfaRequired(:final challenge): await challenge.submit(MfaProof.totp(totpCode));
}

final token = await idenzy.getToken();       // for your own API calls
idenzy.status.listen((status) { /* IdenzyLoading, IdenzySignedOut, IdenzySignedIn */ });
```

## Native sign-in

- **Apple on iOS:** `idenzy.signIn.withApple()` shows the system sheet. Add the app's bundle ID
  to the Apple provider's *App bundle IDs* in the dashboard, and the Sign in with Apple capability
  to the app.
- **Google on Android:** `idenzy.signIn.withGoogle(serverClientId: …)` uses Credential Manager.
  Pass the Google provider's web client ID.
- **Google on iOS, or any other platform sheet:** call `idenzy.nativeSignIn.prepare()`, give the
  returned `digest` to the provider's SDK as its nonce, then `nativeSignIn.exchange(…)` the ID
  token it returns with the `nonce`. Add that SDK's client ID to *Native app client IDs*.
- **Everything else:** `idenzy.signIn.withOAuth(provider: …, redirectUri: …)` opens the system
  browser. On Android, set `manifestPlaceholders["idenzyRedirectScheme"]` to the redirect URI's
  scheme.

## Requirements

iOS 15 with Swift Package Manager enabled for Flutter, and Android API 26.
