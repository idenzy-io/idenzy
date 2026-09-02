import { z } from "zod";
import { MfaFactorType } from "../enums/auth.js";
import { Channel } from "../enums/delivery.js";
import { emailSchema, passwordSchema, phoneSchema } from "./common.js";

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

export type SignUpWithPassword = z.infer<typeof signUpWithPasswordSchema>;
export type SignInWithPassword = z.infer<typeof signInWithPasswordSchema>;
export type StartOtp = z.infer<typeof startOtpSchema>;
export type VerifyOtp = z.infer<typeof verifyOtpSchema>;
export type ExchangeCode = z.infer<typeof exchangeCodeSchema>;
export type SubmitMfa = z.infer<typeof submitMfaSchema>;
