/** Authentication methods, as they appear in the `amr` claim of an access token. */
export const AuthMethod = {
  Password: "pwd",
  EmailOtp: "otp_email",
  SmsOtp: "otp_sms",
  WhatsappOtp: "otp_whatsapp",
  MagicLink: "link",
  Passkey: "webauthn",
  Totp: "totp",
  RecoveryCode: "recovery",
  Oauth: "oauth",
  IdTokenExchange: "id_token",
  Anonymous: "anon",
  CustomToken: "custom",
} as const;
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];

/** Second-factor types a user can enrol. */
export const MfaFactorType = {
  Totp: "totp",
  Passkey: "passkey",
  Sms: "sms",
  RecoveryCode: "recovery",
} as const;
export type MfaFactorType = (typeof MfaFactorType)[keyof typeof MfaFactorType];

/** Why a session ended. Surfaced to the customer in the session list and webhooks. */
export const SessionRevokeReason = {
  SignedOut: "signed_out",
  SignedOutEverywhere: "signed_out_everywhere",
  PasswordChanged: "password_changed",
  RefreshTokenReuse: "refresh_token_reuse",
  AdminRevoked: "admin_revoked",
  UserDeleted: "user_deleted",
  IdleTimeout: "idle_timeout",
  AbsoluteTimeout: "absolute_timeout",
} as const;
export type SessionRevokeReason = (typeof SessionRevokeReason)[keyof typeof SessionRevokeReason];

/**
 * What a single-use verification token is for.
 *
 * Part of the wire contract because the SDK's confirm helper takes it, and because a
 * token minted for one purpose must never be accepted for another: a reset token that
 * could verify an address would let anyone who can request a reset mark it verified.
 */
export const VerificationPurpose = {
  EmailVerification: "email_verification",
  PasswordReset: "password_reset",
} as const;
export type VerificationPurpose = (typeof VerificationPurpose)[keyof typeof VerificationPurpose];
