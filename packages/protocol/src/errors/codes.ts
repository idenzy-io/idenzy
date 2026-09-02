/**
 * Every error Idenzy can return, as a stable machine-readable code.
 *
 * These codes are the customer's UI. Because we ship no authentication UI
 * (PROJECT.md 1.1), a customer builds every message their users read from this
 * enum, so a code is a public API promise: renaming one is a breaking change,
 * and adding one is not.
 */
export const ErrorCode = {
  // Request shape and routing
  ValidationFailed: "validation_failed",
  UnknownProject: "unknown_project",
  ProjectSuspended: "project_suspended",
  NotFound: "not_found",
  Conflict: "conflict",
  IdempotencyKeyReused: "idempotency_key_reused",

  // Caller authentication (the API key or session presented to us)
  MissingCredentials: "missing_credentials",
  InvalidApiKey: "invalid_api_key",
  InsufficientScope: "insufficient_scope",

  // End-user authentication
  InvalidCredentials: "invalid_credentials",
  AccountLocked: "account_locked",
  AccountBanned: "account_banned",
  EmailNotVerified: "email_not_verified",
  PasswordBreached: "password_breached",
  PasswordTooWeak: "password_too_weak",
  IdentityAlreadyLinked: "identity_already_linked",
  LinkingRequiresVerification: "linking_requires_verification",

  // Sessions and tokens
  SessionExpired: "session_expired",
  SessionRevoked: "session_revoked",
  RefreshTokenInvalid: "refresh_token_invalid",
  RefreshTokenReused: "refresh_token_reused",
  ReauthenticationRequired: "reauthentication_required",

  // Multi-factor
  MfaRequired: "mfa_required",
  MfaFactorInvalid: "mfa_factor_invalid",
  MfaFactorAlreadyEnrolled: "mfa_factor_already_enrolled",

  // Challenges (OTP, magic link, passkey, OAuth)
  ChallengeExpired: "challenge_expired",
  ChallengeInvalid: "challenge_invalid",
  ChallengeAttemptsExhausted: "challenge_attempts_exhausted",
  RedirectUriNotAllowed: "redirect_uri_not_allowed",
  OauthStateInvalid: "oauth_state_invalid",
  OauthProviderError: "oauth_provider_error",
  WebauthnAssertionInvalid: "webauthn_assertion_invalid",

  // Abuse, quota and spend
  RateLimited: "rate_limited",
  AttestationRequired: "attestation_required",
  CountryNotAllowed: "country_not_allowed",
  SpendCapReached: "spend_cap_reached",
  QuotaExceeded: "quota_exceeded",

  // Delivery
  DeliverySuppressed: "delivery_suppressed",
  DeliveryFailed: "delivery_failed",

  // Customer-supplied hooks
  HookRejected: "hook_rejected",
  HookTimedOut: "hook_timed_out",

  // Ours, not theirs
  ProviderUnavailable: "provider_unavailable",
  Internal: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
