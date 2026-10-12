import 'package:flutter/material.dart';
import 'package:idenzy_flutter/idenzy_flutter.dart';

/// The smallest app that signs somebody in with Idenzy.
///
/// The screens are the app's, as they always are with Idenzy: this one is a few buttons and a
/// status line, written to show which call does what rather than how a sign-in should look.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final idenzy = await Idenzy.configure(
    publishableKey: const String.fromEnvironment('IDENZY_KEY', defaultValue: 'pk_test_example'),
    apiUrl: const String.fromEnvironment('IDENZY_API', defaultValue: 'http://localhost:3000'),
  );
  runApp(ExampleApp(idenzy: idenzy));
}

class ExampleApp extends StatefulWidget {
  const ExampleApp({super.key, required this.idenzy});

  final Idenzy idenzy;

  @override
  State<ExampleApp> createState() => _ExampleAppState();
}

class _ExampleAppState extends State<ExampleApp> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  String _message = '';

  @override
  void initState() {
    super.initState();
    widget.idenzy.restore().then<void>((_) {}, onError: (Object error) => _say('$error'));
  }

  void _say(String message) => setState(() => _message = message);

  Future<void> _attempt(Future<Object?> Function() call) async {
    try {
      final result = await call();
      if (result is MfaRequired) _say('A second factor is owed: ${result.challenge.factors.first.name}');
    } on IdenzyException catch (error) {
      _say('${error.code.name}: ${error.message}');
    } on IdenzySignInCancelled {
      _say('Cancelled.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final idenzy = widget.idenzy;
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('Idenzy')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            StreamBuilder<IdenzyStatus>(
              stream: idenzy.status,
              initialData: const IdenzyLoading(),
              builder: (context, snapshot) => Text(switch (snapshot.data) {
                IdenzySignedIn(:final user) => 'Signed in as ${user.email ?? user.id}',
                IdenzySignedOut() => 'Signed out',
                _ => 'Loading…',
              }),
            ),
            TextField(
              controller: _email,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            FilledButton(
              onPressed: () => _attempt(() => idenzy.signIn.withEmailOtp(email: _email.text)),
              child: const Text('Send a code'),
            ),
            TextField(
              controller: _code,
              decoration: const InputDecoration(labelText: 'Code'),
            ),
            FilledButton(
              onPressed: () => _attempt(() => idenzy.signIn.verifyOtp(code: _code.text)),
              child: const Text('Verify'),
            ),
            OutlinedButton(onPressed: () => _attempt(idenzy.signIn.withApple), child: const Text('Sign in with Apple')),
            OutlinedButton(
              onPressed: () => _attempt(
                () => idenzy.signIn.withGoogle(serverClientId: const String.fromEnvironment('GOOGLE_WEB_CLIENT_ID')),
              ),
              child: const Text('Sign in with Google'),
            ),
            TextButton(onPressed: () => _attempt(idenzy.signOut), child: const Text('Sign out')),
            Text(_message),
          ],
        ),
      ),
    );
  }
}
