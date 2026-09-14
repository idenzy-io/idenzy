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
  SecretKeyNotPermitted: "secret_key_not_permitted",

  // Browser-only controls. None of these can be provoked by a non-browser client
  // (PROJECT.md 4.3), so an SDK that sees one is looking at a misconfiguration.
  OriginNotAllowed: "origin_not_allowed",
  CsrfCheckFailed: "csrf_check_failed",
  SessionTransportUnavailable: "session_transport_unavailable",

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
  AccessTokenInvalid: "access_token_invalid",
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
  /** The project has turned this way in off, so no account can use it (PROJECT.md 3.2). */
  SignInMethodDisabled: "sign_in_method_disabled",
  /** The method is on, but the project does not accept new accounts through it. */
  SignUpDisabled: "sign_up_disabled",
  /** The password is shorter than the project's own minimum, which may exceed ours. */
  PasswordTooShort: "password_too_short",
  SpendCapReached: "spend_cap_reached",
  QuotaExceeded: "quota_exceeded",

  // Delivery
  DeliverySuppressed: "delivery_suppressed",
  DeliveryFailed: "delivery_failed",

  // Access-token claim templates
  ClaimTemplateUnsatisfied: "claim_template_unsatisfied",

  // Customer-supplied hooks
  HookRejected: "hook_rejected",
  HookTimedOut: "hook_timed_out",

  // Webhooks. The one code we never answer with: a delivery is a request *we* make, so this is
  // raised inside a receiver's own process by the SDK's verifier, and their right answer is 400.
  WebhookSignatureInvalid: "webhook_signature_invalid",

  // Billing. A deployment with no payment provider is a correct one, so asking it to take
  // money is a refusal about this installation rather than about the request: the wallet
  // has already said `provider: null` and the screen is built to show that.
  PaymentsUnavailable: "payments_unavailable",
  PaymentMethodRequired: "payment_method_required",

  // Ours, not theirs
  ProviderUnavailable: "provider_unavailable",
  AnalyticsUnavailable: "analytics_unavailable",
  Internal: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
