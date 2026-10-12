import 'dart:convert';

import 'generated/protocol.dart';

/// The values the native SDKs hand across, as Dart sees them.
///
/// Every timestamp crosses as milliseconds since the epoch and every enum as its wire value, so
/// the shapes here are the protocol's and nothing is reinterpreted on the way.
typedef Wire = Map<String, Object?>;

DateTime _time(Object? millis) => DateTime.fromMillisecondsSinceEpoch(millis! as int, isUtc: true);

DateTime? _optionalTime(Object? millis) => millis == null ? null : _time(millis);

Wire _map(Object? value) => Map<String, Object?>.from(value! as Map);

List<Wire> _list(Object? value) => [for (final item in value! as List) _map(item)];

/// The user as an application sees it. `metadataPublic` is whatever your backend stored.
class User {
  User.fromWire(Wire wire)
      : id = wire['id']! as String,
        email = wire['email'] as String?,
        emailVerified = wire['emailVerified']! as bool,
        phone = wire['phone'] as String?,
        phoneVerified = wire['phoneVerified']! as bool,
        displayName = wire['displayName'] as String?,
        avatarUrl = wire['avatarUrl'] as String?,
        metadataPublic = Map<String, Object?>.from(jsonDecode(wire['metadataPublicJson']! as String) as Map),
        createdAt = _time(wire['createdAt']),
        lastSignInAt = _optionalTime(wire['lastSignInAt']);

  final String id;
  final String? email;
  final bool emailVerified;
  final String? phone;
  final bool phoneVerified;
  final String? displayName;
  final String? avatarUrl;
  final Map<String, Object?> metadataPublic;
  final DateTime createdAt;
  final DateTime? lastSignInAt;

  @override
  bool operator ==(Object other) =>
      other is User && other.id == id && other.displayName == displayName && other.email == email;

  @override
  int get hashCode => Object.hash(id, displayName, email);
}

/// The session handed to your code: the access token, never the refresh token.
class Session {
  Session.fromWire(Wire wire)
      : id = wire['id']! as String,
        user = User.fromWire(_map(wire['user'])),
        accessToken = wire['accessToken']! as String,
        accessTokenExpiresAt = _time(wire['accessTokenExpiresAt']);

  final String id;
  final User user;
  final String accessToken;
  final DateTime accessTokenExpiresAt;
}

/// Where the session stands. [IdenzyLoading] lasts until `restore` has answered: render it as
/// signed out and a signed-in user sees a sign-in screen on every launch.
sealed class IdenzyStatus {
  const IdenzyStatus();

  factory IdenzyStatus.fromWire(Wire wire) => switch (wire['status']) {
        'signedIn' => IdenzySignedIn(User.fromWire(_map(wire['user']))),
        'signedOut' => const IdenzySignedOut(),
        _ => const IdenzyLoading(),
      };
}

class IdenzyLoading extends IdenzyStatus {
  const IdenzyLoading();
}

class IdenzySignedOut extends IdenzyStatus {
  const IdenzySignedOut();
}

class IdenzySignedIn extends IdenzyStatus {
  const IdenzySignedIn(this.user);

  final User user;
}

/// A code or a link is on its way. Answered the same way for an address with an account and one
/// without, so there is nothing here to branch on.
class ChallengeStarted {
  ChallengeStarted.fromWire(Wire wire)
      : challengeId = wire['challengeId']! as String,
        expiresAt = _time(wire['expiresAt']);

  final String challengeId;
  final DateTime expiresAt;
}

/// What proves a second factor.
sealed class MfaProof {
  const MfaProof(this.code);

  const factory MfaProof.totp(String code) = _TotpProof;
  const factory MfaProof.recoveryCode(String code) = _RecoveryCodeProof;

  final String code;

  String get factor;
}

class _TotpProof extends MfaProof {
  const _TotpProof(super.code);

  @override
  String get factor => 'totp';
}

class _RecoveryCodeProof extends MfaProof {
  const _RecoveryCodeProof(super.code);

  @override
  String get factor => 'recovery';
}

/// A sign-in that stopped at a second factor, or a step-up waiting for one. [factors] is
/// strongest first: the first is what to ask for, the rest belong behind "try another way".
class MfaChallenge {
  MfaChallenge.fromWire(Wire wire, this._submit)
      : challengeId = wire['challengeId']! as String,
        purpose = MfaChallengePurpose.fromWire(wire['purpose'] as String?),
        factors = [for (final factor in wire['factors']! as List) MfaFactorType.fromWire(factor as String?)],
        expiresAt = _time(wire['expiresAt']);

  final String challengeId;
  final MfaChallengePurpose purpose;
  final List<MfaFactorType> factors;
  final DateTime expiresAt;
  final Future<Session> Function(String challengeId, MfaProof proof) _submit;

  /// Answers the challenge: a sign-in ends in a session, a step-up in a fresher token.
  Future<Session> submit(MfaProof proof) => _submit(challengeId, proof);
}

/// What every way in answers with: a session, or a challenge to finish first.
sealed class AuthResult {
  const AuthResult();
}

class Authenticated extends AuthResult {
  const Authenticated(this.session);

  final Session session;
}

class MfaRequired extends AuthResult {
  const MfaRequired(this.challenge);

  final MfaChallenge challenge;
}

/// A nonce for one native sign-in: [digest] to the platform's sheet, [nonce] back to Idenzy.
class IdTokenNonce {
  IdTokenNonce.fromWire(Wire wire)
      : nonce = wire['nonce']! as String,
        digest = wire['digest']! as String,
        expiresAt = _time(wire['expiresAt']);

  final String nonce;
  final String digest;
  final DateTime expiresAt;
}

class MfaFactorSummary {
  MfaFactorSummary.fromWire(Wire wire)
      : id = wire['id']! as String,
        type = MfaFactorType.fromWire(wire['type'] as String?),
        label = wire['label'] as String?,
        createdAt = _time(wire['createdAt']),
        lastUsedAt = _optionalTime(wire['lastUsedAt']);

  final String id;
  final MfaFactorType type;
  final String? label;
  final DateTime createdAt;
  final DateTime? lastUsedAt;
}

class MfaFactorList {
  MfaFactorList.fromWire(Wire wire)
      : factors = [for (final factor in _list(wire['factors'])) MfaFactorSummary.fromWire(factor)],
        recoveryCodesRemaining = wire['recoveryCodesRemaining']! as int;

  final List<MfaFactorSummary> factors;
  final int recoveryCodesRemaining;
}

/// The shared secret, once. [uri] is what a QR code encodes; rendering it is yours.
class TotpEnrolment {
  TotpEnrolment.fromWire(Wire wire)
      : factorId = wire['factorId']! as String,
        secret = wire['secret']! as String,
        uri = wire['uri']! as String;

  final String factorId;
  final String secret;
  final String uri;
}

/// Shown once and never again: only digests are kept.
class RecoveryCodes {
  RecoveryCodes.fromWire(Wire wire)
      : codes = [for (final code in wire['codes']! as List) code as String],
        generatedAt = _time(wire['generatedAt']);

  final List<String> codes;
  final DateTime generatedAt;
}

class MfaEnrolmentConfirmed {
  MfaEnrolmentConfirmed.fromWire(Wire wire)
      : factor = MfaFactorSummary.fromWire(_map(wire['factor'])),
        recoveryCodes = wire['recoveryCodes'] == null ? null : RecoveryCodes.fromWire(_map(wire['recoveryCodes']));

  final MfaFactorSummary factor;
  final RecoveryCodes? recoveryCodes;
}

/// A session as the device list shows it. No token material.
class SessionSummary {
  SessionSummary.fromWire(Wire wire)
      : id = wire['id']! as String,
        deviceName = wire['deviceName'] as String?,
        ip = wire['ip'] as String?,
        userAgent = wire['userAgent'] as String?,
        amr = [for (final method in wire['amr']! as List) AuthMethod.fromWire(method as String?)],
        createdAt = _time(wire['createdAt']),
        lastActiveAt = _time(wire['lastActiveAt']),
        absoluteExpiresAt = _time(wire['absoluteExpiresAt']),
        revokedAt = _optionalTime(wire['revokedAt']),
        revokeReason =
            wire['revokeReason'] == null ? null : SessionRevokeReason.fromWire(wire['revokeReason'] as String?),
        current = wire['current']! as bool;

  final String id;
  final String? deviceName;
  final String? ip;
  final String? userAgent;
  final List<AuthMethod> amr;
  final DateTime createdAt;
  final DateTime lastActiveAt;
  final DateTime absoluteExpiresAt;
  final DateTime? revokedAt;
  final SessionRevokeReason? revokeReason;
  final bool current;
}
