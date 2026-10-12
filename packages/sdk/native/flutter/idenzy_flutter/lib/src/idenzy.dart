import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'errors.dart';
import 'generated/protocol.dart';
import 'models.dart';

/// How far a sign-out reaches.
enum SignOutScope {
  /// This session only.
  current,

  /// Every session the user holds, on every device.
  all,
}

/// The providers with a platform sign-in sheet.
enum NativeProvider { apple, google }

/// The client a Flutter app holds (ADR-0022).
///
/// A thin layer over the Swift and Kotlin SDKs, which hold the session, keep the refresh token
/// in the Keychain or the Keystore, and apply the refresh rules. Nothing about the session is
/// decided in Dart; this layer turns calls into channel messages and answers into types.
///
/// There is no UI in it. Every method takes values and returns values or throws an
/// [IdenzyException] whose [IdenzyException.code] your screens are built from.
class Idenzy {
  Idenzy._(this._channel, this._events) {
    signIn = SignIn._(this);
    signUp = SignUp._(this);
    password = PasswordApi._(this);
    nativeSignIn = NativeSignIn._(this);
    anonymous = AnonymousApi._(this);
    account = AccountApi._(this);
    sessions = SessionsApi._(this);
    mfa = MfaApi._(this);
  }

  final MethodChannel _channel;
  final EventChannel _events;
  Stream<IdenzyStatus>? _statuses;

  static Idenzy? _configured;

  late final SignIn signIn;
  late final SignUp signUp;
  late final PasswordApi password;
  late final NativeSignIn nativeSignIn;
  late final AnonymousApi anonymous;
  late final AccountApi account;
  late final SessionsApi sessions;
  late final MfaApi mfa;

  /// Configures the client for a project. One per app: the native SDKs hold one client per
  /// project per process, because two would rotate one refresh token twice and lose the session,
  /// and a second publishable key is refused. The same one again, as a hot restart sends it, is
  /// answered with the client already there.
  ///
  /// A secret key or plain http to a real host is refused here, before anything is sent.
  static Future<Idenzy> configure({
    required String publishableKey,
    required String apiUrl,
    String? deviceName,
    @visibleForTesting MethodChannel channel = const MethodChannel('io.idenzy/sdk'),
    @visibleForTesting EventChannel events = const EventChannel('io.idenzy/status'),
  }) async {
    final client = _configured ?? Idenzy._(channel, events);
    await client._call<void>('configure', {
      'publishableKey': publishableKey,
      'apiUrl': apiUrl,
      'deviceName': deviceName,
    });
    return _configured = client;
  }

  /// The session's status, starting with where it stands now. Stays [IdenzyLoading] until
  /// [restore] has answered.
  Stream<IdenzyStatus> get status => _statuses ??= _events
      .receiveBroadcastStream()
      .map((event) => IdenzyStatus.fromWire(Map<String, Object?>.from(event as Map)))
      .asBroadcastStream();

  /// Picks up the session the last launch stored. Call it once, at start-up. When the answer
  /// cannot be known yet, offline or with a Keychain locked since boot, it throws and keeps the
  /// stored session for a later call.
  Future<Session?> restore() async => _session(await _call<Map>('restore'));

  /// A token for your own API calls, renewed first if close to expiry. Null when signed out.
  Future<String?> getToken() => _call<String>('getToken');

  /// The current session, without a request.
  Future<Session?> currentSession() async => _session(await _call<Map>('session'));

  /// Ends the session on the server and here. Here happens even when the request fails.
  Future<void> signOut({SignOutScope scope = SignOutScope.current}) => _call<void>('signOut', {'scope': scope.name});

  /// Finishes OAuth from the URL the app was opened with, after the system ended the app while
  /// the browser was in front. Null when the URL is not a return from Idenzy.
  Future<AuthResult?> completeRedirect(String url) async =>
      _optionalResult(await _call<Map>('oauth.complete', {'url': url}));

  /// Finishes a magic link from the app link the app was opened with. Null when not ours.
  Future<AuthResult?> completeMagicLink(String url) async =>
      _optionalResult(await _call<Map>('magicLink.complete', {'url': url}));

  Future<T?> _call<T>(String method, [Map<String, Object?>? arguments]) async {
    try {
      return await _channel.invokeMethod<T>(method, arguments);
    } on PlatformException catch (error) {
      throw errorFrom(error);
    }
  }

  Future<T> _require<T>(String method, [Map<String, Object?>? arguments]) async {
    final value = await _call<T>(method, arguments);
    if (value == null) {
      throw IdenzyException(
        code: ErrorCode.providerUnavailable,
        rawCode: 'provider_unavailable',
        message: '$method answered with nothing.',
      );
    }
    return value;
  }

  Session? _session(Map? wire) => wire == null ? null : Session.fromWire(Map<String, Object?>.from(wire));

  Future<AuthResult> _result(String method, [Map<String, Object?>? arguments]) async =>
      _authResult(Map<String, Object?>.from(await _require<Map>(method, arguments)));

  AuthResult? _optionalResult(Map? wire) => wire == null ? null : _authResult(Map<String, Object?>.from(wire));

  AuthResult _authResult(Wire wire) {
    if (wire['status'] == 'mfa_required') {
      return MfaRequired(MfaChallenge.fromWire(Map<String, Object?>.from(wire['challenge']! as Map), _submit));
    }
    return Authenticated(Session.fromWire(Map<String, Object?>.from(wire['session']! as Map)));
  }

  Future<Session> _submit(String challengeId, MfaProof proof) async => Session.fromWire(
        Map<String, Object?>.from(
          await _require<Map>('mfa.submit', {'challengeId': challengeId, 'factor': proof.factor, 'code': proof.code}),
        ),
      );

  Future<Wire> _wire(String method, [Map<String, Object?>? arguments]) async =>
      Map<String, Object?>.from(await _require<Map>(method, arguments));
}

/// Every way in, named the way a sign-in form reads, as in `@idenzy/js`.
class SignIn {
  SignIn._(this._client);

  final Idenzy _client;

  /// Sends a code. Answers the same way for an address with an account and one without.
  Future<ChallengeStarted> withEmailOtp({required String email}) async =>
      ChallengeStarted.fromWire(await _client._wire('otp.startEmail', {'email': email}));

  /// Texts a code, refused where the project does not serve the country or requires an
  /// attestation this call did not carry.
  Future<ChallengeStarted> withSmsOtp({required String phone, String? attestation}) async =>
      ChallengeStarted.fromWire(await _client._wire('otp.startSms', {'phone': phone, 'attestation': attestation}));

  /// Completes the last code started here, or an explicit one carried across a restart.
  Future<AuthResult> verifyOtp({required String code, String? challengeId}) =>
      _client._result('otp.verify', {'code': code, 'challengeId': challengeId});

  Future<AuthResult> withPassword({required String email, required String password}) =>
      _client._result('password.signIn', {'email': email, 'password': password});

  /// Mails a link to a registered universal link or app link; finish with
  /// [Idenzy.completeMagicLink] when the app opens on it.
  Future<ChallengeStarted> withMagicLink({required String email, required String redirectUri}) async =>
      ChallengeStarted.fromWire(await _client._wire('magicLink.start', {'email': email, 'redirectUri': redirectUri}));

  /// Social sign-in in the system browser (`ASWebAuthenticationSession`, Custom Tabs), never a
  /// web view. A closed browser throws [IdenzySignInCancelled].
  Future<AuthResult> withOAuth({required String provider, required String redirectUri}) =>
      _client._result('oauth.signIn', {'provider': provider, 'redirectUri': redirectUri});

  /// The system's Sign in with Apple sheet, on iOS and macOS. Android has no such sheet:
  /// [withOAuth] with `apple` is the way in there.
  Future<AuthResult> withApple() => _client._result('apple.signIn');

  /// Credential Manager's Sign in with Google sheet, on Android. [serverClientId] is the
  /// project's Google web client ID. On iOS, use Google's own SDK with [NativeSignIn], or
  /// [withOAuth] with `google`.
  Future<AuthResult> withGoogle({required String serverClientId}) =>
      _client._result('google.signIn', {'serverClientId': serverClientId});

  /// A real session with no credential, upgradeable later without losing the user id.
  Future<AuthResult> anonymously() => _client._result('anonymous.signIn');
}

/// Registration, which only a password needs: every other way in creates the account.
class SignUp {
  SignUp._(this._client);

  final Idenzy _client;

  Future<AuthResult> withPassword({required String email, required String password, String? displayName}) =>
      _client._result('password.signUp', {'email': email, 'password': password, 'displayName': displayName});
}

class PasswordApi {
  PasswordApi._(this._client);

  final Idenzy _client;

  /// Succeeds for an address with an account and one without.
  Future<void> requestReset({required String email}) => _client._call<void>('password.requestReset', {'email': email});

  /// Does not sign in: the new password is what proves ownership at the next sign-in.
  Future<void> confirmReset({required String token, required String password}) =>
      _client._call<void>('password.confirmReset', {'token': token, 'password': password});
}

/// A platform sign-in this SDK does not drive itself, such as Google's own SDK on iOS: hand
/// [IdTokenNonce.digest] to it as the nonce, then [exchange] the token it returns.
class NativeSignIn {
  NativeSignIn._(this._client);

  final Idenzy _client;

  Future<IdTokenNonce> prepare() async => IdTokenNonce.fromWire(await _client._wire('idToken.prepare'));

  Future<AuthResult> exchange({
    required NativeProvider provider,
    required String idToken,
    required String nonce,
    String? displayName,
  }) =>
      _client._result('idToken.exchange', {
        'provider': provider.name,
        'idToken': idToken,
        'nonce': nonce,
        'displayName': displayName,
      });
}

class AnonymousApi {
  AnonymousApi._(this._client);

  final Idenzy _client;

  /// Keeps the user id and everything attached to it; the credential is what changes.
  Future<AuthResult> upgrade({required String email, required String password}) =>
      _client._result('anonymous.upgrade', {'email': email, 'password': password});
}

class AccountApi {
  AccountApi._(this._client);

  final Idenzy _client;

  Future<User> me() async => User.fromWire(await _client._wire('account.me'));

  Future<void> requestEmailVerification() => _client._call<void>('account.requestEmailVerification');

  Future<void> confirmEmailVerification(String token) =>
      _client._call<void>('account.confirmEmailVerification', {'token': token});

  Future<void> requestEmailChange(String newEmail) =>
      _client._call<void>('account.requestEmailChange', {'newEmail': newEmail});

  /// True once both addresses have confirmed.
  Future<bool> confirmEmailChange(String token) async =>
      (await _client._wire('account.confirmEmailChange', {'token': token}))['applied']! as bool;
}

class SessionsApi {
  SessionsApi._(this._client);

  final Idenzy _client;

  /// Most recently active first, with this device's own marked `current`.
  Future<List<SessionSummary>> list() async => [
        for (final row in await _client._require<List>('sessions.list'))
          SessionSummary.fromWire(Map<String, Object?>.from(row as Map)),
      ];

  Future<void> revoke(String id) => _client._call<void>('sessions.revoke', {'id': id});
}

class MfaApi {
  MfaApi._(this._client);

  final Idenzy _client;

  Future<MfaFactorList> factors() async => MfaFactorList.fromWire(await _client._wire('mfa.factors'));

  Future<TotpEnrolment> enrollTotp({String? label}) async =>
      TotpEnrolment.fromWire(await _client._wire('mfa.enrollTotp', {'label': label}));

  Future<MfaEnrolmentConfirmed> confirmTotp({required String factorId, required String code}) async =>
      MfaEnrolmentConfirmed.fromWire(await _client._wire('mfa.confirmTotp', {'factorId': factorId, 'code': code}));

  Future<RecoveryCodes> regenerateRecoveryCodes() async =>
      RecoveryCodes.fromWire(await _client._wire('mfa.regenerateRecoveryCodes'));

  Future<void> removeFactor(String factorId) => _client._call<void>('mfa.removeFactor', {'factorId': factorId});

  /// A challenge to raise this session's assurance, or null when none is owed.
  Future<MfaChallenge?> startStepUp() async {
    final wire = await _client._call<Map>('mfa.startStepUp');
    return wire == null ? null : MfaChallenge.fromWire(Map<String, Object?>.from(wire), _client._submit);
  }
}
