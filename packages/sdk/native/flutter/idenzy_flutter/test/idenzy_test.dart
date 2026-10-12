import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:idenzy_flutter/idenzy_flutter.dart';

/// The Dart layer against a stand-in for the native SDKs.
///
/// Only the translation is under test here: what Dart sends, and what it makes of the answer.
/// The behaviour behind the channel is the Swift and Kotlin SDKs', tested there and in the core.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('io.idenzy/sdk');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final calls = <MethodCall>[];
  late Idenzy idenzy;

  const userWire = {
    'id': 'usr_00000000000000000001',
    'email': 'ada@example.com',
    'emailVerified': true,
    'phone': null,
    'phoneVerified': false,
    'displayName': 'Ada',
    'avatarUrl': null,
    'metadataPublicJson': '{"plan":"pro"}',
    'createdAt': 1791788400000,
    'lastSignInAt': null,
  };
  const sessionWire = {
    'id': 'ses_00000000000000000001',
    'user': userWire,
    'accessToken': 'access.token.value',
    'accessTokenExpiresAt': 1791788700000,
  };

  void answer(Object? Function(MethodCall call) reply) {
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return reply(call);
    });
  }

  setUp(() async {
    calls.clear();
    answer((_) => null);
    idenzy = await Idenzy.configure(publishableKey: 'pk_test_1', apiUrl: 'https://auth.example.test');
  });

  test('configure hands the native SDK the project and nothing else', () {
    expect(calls.single.method, 'configure');
    expect(calls.single.arguments, {
      'publishableKey': 'pk_test_1',
      'apiUrl': 'https://auth.example.test',
      'deviceName': null,
    });
  });

  test('a password sign-in arrives as a session with a typed user', () async {
    answer((_) => {'status': 'authenticated', 'session': sessionWire});

    final result = await idenzy.signIn.withPassword(email: 'ada@example.com', password: 'pw');

    expect(calls.last.method, 'password.signIn');
    final session = (result as Authenticated).session;
    expect(session.accessToken, 'access.token.value');
    expect(session.user.metadataPublic, {'plan': 'pro'});
    expect(session.user.createdAt, DateTime.utc(2026, 10, 12, 7));
  });

  test('a challenge is answered through the challenge, by its id', () async {
    answer((call) => switch (call.method) {
          'password.signIn' => {
              'status': 'mfa_required',
              'challenge': {
                'challengeId': 'chl_1',
                'purpose': 'sign_in',
                'factors': ['totp', 'carrier_pigeon'],
                'expiresAt': 1791789000000,
              },
            },
          'mfa.submit' => sessionWire,
          _ => null,
        });

    final result = await idenzy.signIn.withPassword(email: 'ada@example.com', password: 'pw');
    final challenge = (result as MfaRequired).challenge;
    expect(challenge.purpose, MfaChallengePurpose.signIn);
    expect(challenge.factors, [MfaFactorType.totp, MfaFactorType.unrecognized]);

    final session = await challenge.submit(const MfaProof.recoveryCode('ABCDE-FGHIJ'));
    expect(session.id, 'ses_00000000000000000001');
    expect(calls.last.arguments, {'challengeId': 'chl_1', 'factor': 'recovery', 'code': 'ABCDE-FGHIJ'});
  });

  test('a refusal arrives as its stable code, with the detail beside it', () async {
    answer((_) => throw PlatformException(
          code: 'rate_limited',
          message: 'Slow down.',
          details: {
            'status': 429,
            'requestId': 'req_2',
            'retryAfterSeconds': 30,
            'fields': [
              {'path': 'email', 'code': 'invalid'},
            ],
          },
        ));

    await expectLater(
      idenzy.signIn.withPassword(email: 'ada@example.com', password: 'pw'),
      throwsA(isA<IdenzyException>()
          .having((error) => error.code, 'code', ErrorCode.rateLimited)
          .having((error) => error.status, 'status', 429)
          .having((error) => error.retryAfterSeconds, 'retryAfterSeconds', 30)
          .having((error) => error.fields.single.path, 'field', 'email')),
    );
  });

  test('a code newer than this build is unrecognised, and still readable', () async {
    answer((_) => throw PlatformException(code: 'brand_new_code', message: 'No.'));
    await expectLater(
      idenzy.getToken(),
      throwsA(isA<IdenzyException>()
          .having((error) => error.code, 'code', ErrorCode.unrecognized)
          .having((error) => error.rawCode, 'rawCode', 'brand_new_code')),
    );
  });

  test('a closed sign-in sheet is a cancel, not an error', () async {
    answer((_) => throw PlatformException(code: 'cancelled'));
    await expectLater(idenzy.signIn.withApple(), throwsA(isA<IdenzySignInCancelled>()));
  });

  test('a lost refresh says it was interrupted, which a screen treats differently from offline', () async {
    answer((_) => throw PlatformException(
          code: 'provider_unavailable',
          message: 'timed out',
          details: {'status': 0, 'transportReason': 'interrupted'},
        ));
    await expectLater(
      idenzy.getToken(),
      throwsA(isA<IdenzyException>().having((error) => error.transportReason, 'reason', TransportReason.interrupted)),
    );
  });

  test('a native sign-in sends the nonce, never the digest', () async {
    answer((call) => switch (call.method) {
          'idToken.prepare' => {'nonce': 'server-nonce', 'digest': 'abc123', 'expiresAt': 1791789000000},
          'idToken.exchange' => {'status': 'authenticated', 'session': sessionWire},
          _ => null,
        });

    final prepared = await idenzy.nativeSignIn.prepare();
    await idenzy.nativeSignIn
        .exchange(provider: NativeProvider.google, idToken: 'google.id.token', nonce: prepared.nonce);

    expect(calls.last.arguments, {
      'provider': 'google',
      'idToken': 'google.id.token',
      'nonce': 'server-nonce',
      'displayName': null,
    });
  });

  test('status starts loading and follows what the native SDK reports', () async {
    const events = EventChannel('io.idenzy/status');
    messenger.setMockStreamHandler(
      events,
      MockStreamHandler.inline(onListen: (arguments, sink) {
        sink.success({'status': 'loading'});
        sink.success({'status': 'signedIn', 'user': userWire});
        sink.success({'status': 'signedOut'});
      }),
    );

    final statuses = await idenzy.status.take(3).toList();

    expect(statuses[0], isA<IdenzyLoading>());
    expect((statuses[1] as IdenzySignedIn).user.email, 'ada@example.com');
    expect(statuses[2], isA<IdenzySignedOut>());
  });
}
