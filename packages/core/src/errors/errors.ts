import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { ErrorOptions } from "./idenzy-error.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServerError,
  TooManyRequestsError,
  UnauthorizedError,
  UpstreamError,
} from "./status-errors.js";

export class ValidationFailedError extends BadRequestError {
  override readonly code = ErrorCode.ValidationFailed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The request body failed validation.", options);
  }
}

export class UnknownProjectError extends NotFoundError {
  override readonly code = ErrorCode.UnknownProject;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "No project matches this host or key.", options);
  }
}

export class ResourceNotFoundError extends NotFoundError {
  override readonly code = ErrorCode.NotFound;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Not found.", options);
  }
}

export class ResourceConflictError extends ConflictError {
  override readonly code = ErrorCode.Conflict;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That resource already exists.", options);
  }
}

export class MissingCredentialsError extends UnauthorizedError {
  override readonly code = ErrorCode.MissingCredentials;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "No credentials were presented.", options);
  }
}

export class InvalidApiKeyError extends UnauthorizedError {
  override readonly code = ErrorCode.InvalidApiKey;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The API key is invalid or revoked.", options);
  }
}

export class InsufficientScopeError extends ForbiddenError {
  override readonly code = ErrorCode.InsufficientScope;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This key lacks the required scope.", options);
  }
}

/**
 * Deliberately identical for "no such user" and "wrong password", and thrown after the
 * same amount of work in both cases (PROJECT.md 4.5). Do not add a distinguishing
 * message or a fast path.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  override readonly code = ErrorCode.InvalidCredentials;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Invalid email or password.", options);
  }
}

/**
 * A ban is a deliberate state, so unlike InvalidCredentials it says so: the account
 * holder needs to know why they cannot get in, and an attacker learns nothing they
 * could not learn by trying a correct password.
 */
export class AccountBannedError extends ForbiddenError {
  override readonly code = ErrorCode.AccountBanned;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This account is suspended.", options);
  }
}

/** Thrown only where the project requires verification before a session, never at sign-up. */
export class EmailNotVerifiedError extends ForbiddenError {
  override readonly code = ErrorCode.EmailNotVerified;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This email address is not verified.", options);
  }
}

/**
 * The password appears in a known breach corpus (PROJECT.md 4.5). Raised at sign-up and
 * reset, never at sign-in: refusing an existing password at the door locks the user out
 * of their own account without giving them a way back in.
 */
export class PasswordBreachedError extends BadRequestError {
  override readonly code = ErrorCode.PasswordBreached;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This password has appeared in a data breach.", options);
  }
}

export class SessionExpiredError extends UnauthorizedError {
  override readonly code = ErrorCode.SessionExpired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The session has expired.", options);
  }
}

export class RefreshTokenInvalidError extends UnauthorizedError {
  override readonly code = ErrorCode.RefreshTokenInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The refresh token is not valid.", options);
  }
}

/**
 * Reuse of an already-rotated refresh token. Throwing this must also revoke the whole
 * family and emit a security event; the error alone is not the mitigation
 * (PROJECT.md 4.2).
 */
export class RefreshTokenReusedError extends UnauthorizedError {
  override readonly code = ErrorCode.RefreshTokenReused;
  constructor(options: ErrorOptions = {}) {
    super(
      options.message ?? "This refresh token was already used. The session is revoked.",
      options,
    );
  }
}

export class SessionRevokedError extends UnauthorizedError {
  override readonly code = ErrorCode.SessionRevoked;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The session was revoked.", options);
  }
}

export class ReauthenticationRequiredError extends ForbiddenError {
  override readonly code = ErrorCode.ReauthenticationRequired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Re-authenticate to perform this action.", options);
  }
}

export class MfaRequiredError extends ForbiddenError {
  override readonly code = ErrorCode.MfaRequired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "A second factor is required.", options);
  }
}

export class ChallengeExpiredError extends BadRequestError {
  override readonly code = ErrorCode.ChallengeExpired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This challenge has expired.", options);
  }
}

export class ChallengeInvalidError extends BadRequestError {
  override readonly code = ErrorCode.ChallengeInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That code is not correct.", options);
  }
}

/**
 * The attempt cap is reached, so the challenge is dead even though the code may still
 * be within its lifetime. Distinct from ChallengeInvalid because the client must stop
 * retrying and start a new challenge (PROJECT.md 4.7).
 */
export class ChallengeAttemptsExhaustedError extends BadRequestError {
  override readonly code = ErrorCode.ChallengeAttemptsExhausted;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Too many incorrect attempts. Request a new code.", options);
  }
}

/** The provider account already belongs to a different user in this project. */
export class IdentityAlreadyLinkedError extends ConflictError {
  override readonly code = ErrorCode.IdentityAlreadyLinked;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That account is already linked to another user.", options);
  }
}

/**
 * An unverified provider email matched an existing account (PROJECT.md 4.6). Linking on
 * that alone is the classic IdP account-takeover, so the customer's UI must send the
 * user through an email OTP first.
 */
export class LinkingRequiresVerificationError extends ForbiddenError {
  override readonly code = ErrorCode.LinkingRequiresVerification;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Verify this email address before linking the account.", options);
  }
}

/** Exact-match allowlist failure. Never echo the offending URI back (open-redirect bait). */
export class RedirectUriNotAllowedError extends BadRequestError {
  override readonly code = ErrorCode.RedirectUriNotAllowed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That redirect URI is not registered for this project.", options);
  }
}

export class RateLimitedError extends TooManyRequestsError {
  override readonly code = ErrorCode.RateLimited;
  constructor(retryAfterSeconds: number, options: ErrorOptions = {}) {
    super(options.message ?? "Too many requests.", { ...options, retryAfterSeconds });
  }
}

export class SpendCapReachedError extends ForbiddenError {
  override readonly code = ErrorCode.SpendCapReached;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The project spend cap for this channel is reached.", options);
  }
}

export class ProviderUnavailableError extends UpstreamError {
  override readonly code = ErrorCode.ProviderUnavailable;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "An upstream provider is unavailable.", options);
  }
}

/** The catch-all. Its message is fixed so nothing internal leaks through the filter. */
export class InternalError extends ServerError {
  override readonly code = ErrorCode.Internal;
  constructor(options: ErrorOptions = {}) {
    super("An internal error occurred.", options);
  }
}
