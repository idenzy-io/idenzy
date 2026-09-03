import { z } from "zod";
import { MfaChallengePurpose, MfaFactorType } from "../enums/auth.js";
import { challengeIdSchema, factorIdSchema, isoDateTimeSchema } from "./common.js";
import { sessionCreatedSchema } from "./session.js";
import { authenticationResponseSchema, passkeyAuthenticationOptionsSchema } from "./webauthn.js";

const factorTypeValues = Object.values(MfaFactorType) as [MfaFactorType, ...MfaFactorType[]];
const purposeValues = Object.values(MfaChallengePurpose) as [
  MfaChallengePurpose,
  ...MfaChallengePurpose[],
];

/**
 * A second factor is owed.
 *
 * Returned in place of a session and never as an error, because a first factor that
 * verified is not a failure. Modelling it as one would make the normal path of every
 * MFA-enabled sign-in a `catch` block, and would put the challenge id into an error body
 * whose shape is otherwise identical on every endpoint.
 *
 * `factors` is what the customer's UI prompts with, so it has to be here. It is not an
 * enumeration oracle: nothing reaches this response without a proved first factor.
 */
/** The same shape the sign-in ceremony returns, so a client reuses its own ceremony code. */
export const mfaPasskeyOptionsSchema = passkeyAuthenticationOptionsSchema;

export const mfaChallengeSchema = z.object({
  challengeId: challengeIdSchema,
  purpose: z.enum(purposeValues),
  factors: z.array(z.enum(factorTypeValues)),
  expiresAt: isoDateTimeSchema,
});

/**
 * What a sign-in answers with.
 *
 * A discriminated union rather than a session with nullable fields, so a client that
 * ignores the second case does not compile. Every flow that ends in a session returns
 * this shape, including the ones that can never challenge: a caller branching on
 * `status` should not have to know which endpoints those are.
 */
export const authOutcomeSchema = z.discriminatedUnion("status", [
  sessionCreatedSchema.extend({ status: z.literal("authenticated") }),
  mfaChallengeSchema.extend({ status: z.literal("mfa_required") }),
]);

const totpProofSchema = z.object({
  factor: z.literal(MfaFactorType.Totp),
  code: z.string().regex(/^\d{6}$/),
});

const recoveryProofSchema = z.object({
  factor: z.literal(MfaFactorType.RecoveryCode),
  /** Wide enough for the separators the codes are displayed with. */
  code: z.string().min(6).max(64),
});

const passkeyProofSchema = z.object({
  factor: z.literal(MfaFactorType.Passkey),
  /**
   * The WebAuthn ceremony this assertion was produced for, from the options call.
   *
   * A second id, and a second concept: the challenge id in the submission is the second
   * factor being owed, and this is the nonce the authenticator signed over. Collapsing
   * them would mean a factor reading the challenge it is being checked against, which is
   * one level up from where a factor's business ends.
   */
  ceremonyId: challengeIdSchema,
  response: authenticationResponseSchema,
});

/**
 * What proves a factor, without the challenge it is proved against.
 *
 * Discriminated on `factor` rather than carrying one loose `code`, because a proof is not
 * one shape: a TOTP code is six digits, a recovery code is four groups of five, and a
 * passkey assertion is a signed object several hundred bytes long. One field wide enough
 * for all three would validate none of them. `factor` is what the server dispatches on in
 * any case, and guessing it from the shape of the value would have to be revised every
 * time a factor is added, which changes what an existing proof is checked against.
 *
 * Split from the submission below because a factor never reads the challenge id: it is
 * the challenge's business, and handing it to the thing that checks a code would let a
 * factor start making decisions that belong one level up.
 */
export const mfaProofSchema = z.discriminatedUnion("factor", [
  totpProofSchema,
  recoveryProofSchema,
  passkeyProofSchema,
]);

/** A proof, and the challenge it answers. */
export const submitMfaSchema = z.discriminatedUnion("factor", [
  totpProofSchema.extend({ challengeId: challengeIdSchema }),
  recoveryProofSchema.extend({ challengeId: challengeIdSchema }),
  passkeyProofSchema.extend({ challengeId: challengeIdSchema }),
]);

/**
 * Options for answering a challenge with a passkey.
 *
 * Asked for separately rather than returned with the challenge, because generating them
 * writes a WebAuthn nonce and most challenges are answered with a code. Unlike the
 * options at the door these do name credentials: the caller has already proved a first
 * factor for this account, so `allowCredentials` tells them nothing they did not know,
 * and without it a browser holding keys for several accounts cannot pick the right one.
 */
export const mfaPasskeyOptionsRequestSchema = z.object({
  challengeId: challengeIdSchema,
});

/**
 * Begins TOTP enrolment. The factor exists from here but cannot satisfy anything until
 * a code generated from it comes back, which is what proves the secret arrived intact.
 */
export const startTotpEnrolmentSchema = z.object({
  /** Shown on the user's own security screen, so they can tell two authenticators apart. */
  label: z.string().min(1).max(100).optional(),
});

/**
 * The shared secret, once.
 *
 * Both forms are returned because the customer needs both: `uri` is what a QR code
 * encodes, and `secret` is what somebody types when they cannot scan one. We render no
 * QR image, because rendering is theirs (ADR-0002) and an <img> from us on a sign-in
 * screen is the authentication UI this product does not ship.
 */
export const totpEnrolmentSchema = z.object({
  factorId: factorIdSchema,
  /** Base32, unpadded, as RFC 4648 and every authenticator app expect it. */
  secret: z.string(),
  uri: z.string().startsWith("otpauth://totp/"),
});

export const confirmTotpEnrolmentSchema = z.object({
  factorId: factorIdSchema,
  code: z.string().regex(/^\d{6}$/),
});

/**
 * Recovery codes, returned once and never again.
 *
 * Only digests are kept, so a customer that does not show these to the user has lost
 * them. Regenerating is the documented way out, and it invalidates every earlier code.
 */
export const recoveryCodesSchema = z.object({
  codes: z.array(z.string()),
  generatedAt: isoDateTimeSchema,
});

/** An enrolled factor as a "your security" screen shows it. Carries no secret. */
export const mfaFactorSummarySchema = z.object({
  id: factorIdSchema,
  type: z.enum(factorTypeValues),
  label: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
});

/**
 * A confirmed enrolment, and the sheet that came with it.
 *
 * `recoveryCodes` is present the first time a user gets a second factor and null after
 * that, because reissuing on every enrolment would invalidate a sheet somebody already
 * printed. Returning them here rather than leaving them to a second call is deliberate:
 * a customer who forgets that call ships a product where a lost phone is a lost account.
 */
export const mfaEnrolmentConfirmedSchema = z.object({
  factor: mfaFactorSummarySchema,
  recoveryCodes: recoveryCodesSchema.nullable(),
});

/**
 * Everything the user holds. Recovery codes are a count rather than a list, because the
 * list exists only in the reply that generated it.
 */
export const mfaFactorListSchema = z.object({
  factors: z.array(mfaFactorSummarySchema),
  recoveryCodesRemaining: z.number().int().nonnegative(),
});

/**
 * A fresh access token, carrying the `fva` the step-up just earned.
 *
 * No refresh token and no session id: nothing about the session changed except when its
 * second factor was last proved, and reissuing the credential that mints tokens for a
 * check that only reads would be a rotation nobody asked for.
 */
export const stepUpCompletedSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  factorVerifiedAt: isoDateTimeSchema,
});

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;
export type AuthOutcome = z.infer<typeof authOutcomeSchema>;
export type MfaProof = z.infer<typeof mfaProofSchema>;
export type SubmitMfa = z.infer<typeof submitMfaSchema>;
export type MfaPasskeyOptionsRequest = z.infer<typeof mfaPasskeyOptionsRequestSchema>;
export type MfaPasskeyOptions = z.infer<typeof mfaPasskeyOptionsSchema>;
export type StartTotpEnrolment = z.infer<typeof startTotpEnrolmentSchema>;
export type TotpEnrolment = z.infer<typeof totpEnrolmentSchema>;
export type ConfirmTotpEnrolment = z.infer<typeof confirmTotpEnrolmentSchema>;
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;
export type MfaFactorSummary = z.infer<typeof mfaFactorSummarySchema>;
export type MfaEnrolmentConfirmed = z.infer<typeof mfaEnrolmentConfirmedSchema>;
export type MfaFactorList = z.infer<typeof mfaFactorListSchema>;
export type StepUpCompleted = z.infer<typeof stepUpCompletedSchema>;
