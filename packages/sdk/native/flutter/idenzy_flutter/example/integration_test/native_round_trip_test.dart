import 'package:flutter_test/flutter_test.dart';
import 'package:idenzy_flutter/idenzy_flutter.dart';
import 'package:integration_test/integration_test.dart';

/// The whole chain on a device: Dart, the channel, the platform plugin, the native SDK, the Rust
/// core, the platform's HTTP stack, and back. No Idenzy server is needed: every assertion here is
/// about an answer the stack gives without one, which is also what proves each layer is wired.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  // First, while nothing is configured: once a project is, any other key is refused for that reason.
  testWidgets('a secret key is refused on the device, before anything is sent', (tester) async {
    await expectLater(
      Idenzy.configure(publishableKey: 'sk_live_round_trip', apiUrl: 'https://auth.example.test'),
      throwsA(isA<IdenzyException>().having((error) => error.code, 'code', ErrorCode.validationFailed)),
    );
  });

  testWidgets('a fresh install is signed out, and an unreachable API is reported as never reached', (tester) async {
    final idenzy = await Idenzy.configure(
      publishableKey: 'pk_test_round_trip',
      // Port 9 on loopback: nothing listens, so the connection is refused before a byte is sent.
      apiUrl: 'http://127.0.0.1:9',
    );

    expect(await idenzy.restore(), isNull, reason: 'nothing stored on a fresh install');
    expect(await idenzy.getToken(), isNull);
    expect(await idenzy.status.firstWhere((status) => status is! IdenzyLoading), isA<IdenzySignedOut>());

    await expectLater(
      idenzy.signIn.withPassword(email: 'ada@example.com', password: 'correct horse'),
      throwsA(
        isA<IdenzyException>()
            .having((error) => error.code, 'code', ErrorCode.providerUnavailable)
            .having((error) => error.transportReason, 'reason', TransportReason.notSent)
            .having((error) => error.status, 'status', 0),
      ),
    );
  });

  testWidgets('a second project is refused rather than taking over the first', (tester) async {
    await expectLater(
      Idenzy.configure(publishableKey: 'pk_test_other', apiUrl: 'http://127.0.0.1:9'),
      throwsA(isA<IdenzyException>().having((error) => error.code, 'code', ErrorCode.validationFailed)),
    );
  });
}
