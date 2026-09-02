import { z } from "zod";
import { MfaFactorType } from "../enums/auth.js";
import { Channel } from "../enums/delivery.js";
import { emailSchema, isoDateTimeSchema, passwordSchema, phoneSchema } from "./common.js";

const mfaFactorValues = Object.values(MfaFactorType) as [MfaFactorType, ...MfaFactorType[]];

export const signUpWithPasswordSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().max(200).optional(),
});

export const signInWithPasswordSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/** Starts an OTP challenge. The response never reveals whether the target exists. */
export const startOtpSchema = z
  .object({
    channel: z.enum([Channel.Email, Channel.Sms, Channel.Whatsapp]),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((v) => (v.channel === Channel.Email ? Boolean(v.email) : Boolean(v.phone)), {
    message: "email is required for the email channel, phone for sms and whatsapp",
  });

/** Completes an OTP challenge. Attempts are counted server-side and capped at 5. */
export const verifyOtpSchema = z.object({
  challengeId: z.string(),
  code: z.string().regex(/^\d{6,8}$/),
});

/**
 * Exchanges the single-use code returned to a customer-registered redirect URI.
 *
 * This is how both OAuth and magic-link flows finish. We 302 to the customer's own
 * route carrying this code, because we render no page of our own (PROJECT.md 4.6, 4.7).
 */
export const exchangeCodeSchema = z.object({
  code: z.string().min(20),
  codeVerifier: z.string().min(43).max(128).optional(),
});

export const submitMfaSchema = z.object({
  challengeId: z.string(),
  factor: z.enum(mfaFactorValues),
  code: z.string().min(6).max(20),
});

/**
 * A started challenge, returned identically whether or not the target exists.
 *
 * The challenge id is safe to hand back: it is unguessable and useless without the code
 * that was delivered out of band, and returning one unconditionally is what stops this
 * endpoint from being an account-enumeration oracle (PROJECT.md 4.7).
 */
export const challengeStartedSchema = z.object({
  challengeId: z.string(),
  expiresAt: isoDateTimeSchema,
});

/**
 * Refresh. The token is in the body only for clients that cannot hold a cookie;
 * on the web it arrives as the `__Host-` cookie and is never seen by JavaScript
 * (PROJECT.md 4.3).
 */
export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

/** "all" revokes every session the user holds, not only the one presenting the request. */
export const signOutSchema = z.object({
  scope: z.enum(["current", "all"]).default("current"),
});

/** Answered the same way for a known and an unknown address, always 202. */
export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

/**
 * Reset tokens are single-use and 15 minutes long, and confirming one invalidates every
 * other outstanding reset for that user (PROJECT.md 4.5).
 */
export const confirmPasswordResetSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
  signOutOtherSessions: z.boolean().default(true),
});

/** Requires a recent factor verification, and confirms on both addresses (PROJECT.md 4.5). */
export const requestEmailChangeSchema = z.object({
  newEmail: emailSchema,
});

export const confirmEmailChangeSchema = z.object({
  token: z.string().min(20),
});

/**
 * Magic link. `redirectUri` must already be registered for the project: it is pinned to
 * the token at issue time, so the destination cannot change between sending the mail
 * and clicking it (PROJECT.md 4.7).
 */
export const startMagicLinkSchema = z.object({
  email: emailSchema,
  redirectUri: z.url(),
});

/** The query our API receives when the user clicks. It answers with a 302, never a page. */
export const magicLinkCallbackSchema = z.object({
  token: z.string().min(20),
});

/** Turns an anonymous account into a real one, keeping the same user id and its data. */
export const upgradeAnonymousSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type SignUpWithPassword = z.infer<typeof signUpWithPasswordSchema>;
export type SignInWithPassword = z.infer<typeof signInWithPasswordSchema>;
export type StartOtp = z.infer<typeof startOtpSchema>;
export type VerifyOtp = z.infer<typeof verifyOtpSchema>;
export type ExchangeCode = z.infer<typeof exchangeCodeSchema>;
export type SubmitMfa = z.infer<typeof submitMfaSchema>;
export type ChallengeStarted = z.infer<typeof challengeStartedSchema>;
export type RefreshSession = z.infer<typeof refreshSessionSchema>;
export type SignOut = z.infer<typeof signOutSchema>;
export type RequestPasswordReset = z.infer<typeof requestPasswordResetSchema>;
export type ConfirmPasswordReset = z.infer<typeof confirmPasswordResetSchema>;
export type RequestEmailChange = z.infer<typeof requestEmailChangeSchema>;
export type ConfirmEmailChange = z.infer<typeof confirmEmailChangeSchema>;
export type StartMagicLink = z.infer<typeof startMagicLinkSchema>;
export type MagicLinkCallback = z.infer<typeof magicLinkCallbackSchema>;
export type UpgradeAnonymous = z.infer<typeof upgradeAnonymousSchema>;
