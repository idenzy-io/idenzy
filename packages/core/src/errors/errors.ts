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
