import 'package:flutter/services.dart';

import 'generated/protocol.dart';

/// Field-level detail on `validation_failed`, in the protocol's own shape.
class FieldError {
  const FieldError({required this.path, required this.code});

  final String path;
  final String code;
}

/// Why a request produced no answer the SDK could use. `notSent` spent nothing; `interrupted`
/// may have reached the API; `unexpectedResponse` was answered by something that is not us.
enum TransportReason { notSent, interrupted, unexpectedResponse }

/// Everything the SDK throws, except a sign-in sheet the user closed.
///
/// Branch on [code], never on [message]: the codes are the API's stable contract, and the
/// screens built from them are yours (Idenzy ships no authentication UI). [rawCode] keeps a
/// code newer than this build, which then arrives as [ErrorCode.unrecognized].
class IdenzyException implements Exception {
  const IdenzyException({
    required this.code,
    required this.rawCode,
    required this.message,
    this.status = 0,
    this.requestId,
    this.retryAfterSeconds,
    this.fields = const [],
    this.transportReason,
  });

  final ErrorCode code;
  final String rawCode;
  final String message;

  /// The HTTP status, or 0 when nothing came back at all.
  final int status;

  /// Quote this in a support request. Present when the API answered.
  final String? requestId;
  final int? retryAfterSeconds;
  final List<FieldError> fields;
  final TransportReason? transportReason;

  @override
  String toString() => 'IdenzyException($rawCode, $status): $message';
}

/// The user closed a sign-in sheet or browser before it finished. Not an error to report;
/// what a cancel means is the screen's decision.
class IdenzySignInCancelled implements Exception {
  const IdenzySignInCancelled();

  @override
  String toString() => 'IdenzySignInCancelled';
}

/// What a platform call threw, as the SDK's own types.
Exception errorFrom(PlatformException error) {
  if (error.code == 'cancelled') return const IdenzySignInCancelled();
  final details = error.details is Map ? Map<String, Object?>.from(error.details as Map) : <String, Object?>{};
  final fields = (details['fields'] as List?) ?? const [];
  final reason = details['transportReason'] as String?;
  return IdenzyException(
    code: ErrorCode.fromWire(error.code),
    rawCode: error.code,
    message: error.message ?? error.code,
    status: (details['status'] as int?) ?? 0,
    requestId: details['requestId'] as String?,
    retryAfterSeconds: details['retryAfterSeconds'] as int?,
    fields: [
      for (final field in fields)
        if (field is Map) FieldError(path: '${field['path']}', code: '${field['code']}'),
    ],
    transportReason: switch (reason) {
      'notSent' => TransportReason.notSent,
      'interrupted' => TransportReason.interrupted,
      'unexpectedResponse' => TransportReason.unexpectedResponse,
      _ => null,
    },
  );
}
