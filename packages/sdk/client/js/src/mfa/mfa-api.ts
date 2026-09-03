import {
  type ConfirmTotpEnrolment,
  type MfaEnrolmentConfirmed,
  type MfaFactorList,
  mfaChallengeSchema,
  mfaEnrolmentConfirmedSchema,
  mfaFactorListSchema,
  type RecoveryCodes,
  recoveryCodesSchema,
  type StartTotpEnrolment,
  stepUpCompletedSchema,
  type TotpEnrolment,
  totpEnrolmentSchema,
} from "@idenzy/protocol/schemas/mfa";
import type { ApiClient } from "../http/api-client.js";
import type { SessionManager } from "../session/session-manager.js";
import { MfaChallenge, type MfaSubmission } from "./auth-result.js";

/**
 * Enrolling second factors, and proving one again inside a session (PROJECT.md 4.5).
 *
 * What enrolment returns is an `otpauth://` URI and the raw secret, and never an image. The
 * QR code belongs to the customer's page, drawn with their own library, for the same reason
 * their sign-in screen does (ADR-0002). The URI is what a scan produces; the secret is what
 * somebody types when they cannot scan.
 */
export class MfaApi {
  constructor(
    private readonly api: ApiClient,
    private readonly sessions: SessionManager,
  ) {}

  async factors(): Promise<MfaFactorList> {
    return this.api.send(mfaFactorListSchema, {
      method: "GET",
      path: "v1/auth/mfa/factors",
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * Starts an enrolment. Nothing it returns can satisfy a sign-in until it is confirmed,
   * which is what proves the secret reached the authenticator intact.
   */
  async enrollTotp(input: StartTotpEnrolment = {}): Promise<TotpEnrolment> {
    return this.api.send(totpEnrolmentSchema, {
      method: "POST",
      path: "v1/auth/mfa/totp",
      body: input,
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * Confirms it with a code the app generated.
   *
   * `recoveryCodes` comes back on the first factor a user enrols and is null after that.
   * Show them once: only digests are kept, so an application that does not is one where a
   * lost phone is a lost account.
   */
  async confirmTotp(input: ConfirmTotpEnrolment): Promise<MfaEnrolmentConfirmed> {
    return this.api.send(mfaEnrolmentConfirmedSchema, {
      method: "POST",
      path: "v1/auth/mfa/totp/confirm",
      body: input,
      accessToken: await this.sessions.requireToken(),
    });
  }

  /** Replaces the whole sheet. Every earlier code stops working the moment this returns. */
  async regenerateRecoveryCodes(): Promise<RecoveryCodes> {
    return this.api.send(recoveryCodesSchema, {
      method: "POST",
      path: "v1/auth/mfa/recovery-codes",
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * Removes a factor. Needs a recently proved one, so a step-up may be asked for first.
   *
   * That is not an inconvenience to design around: turning MFA off is the first thing
   * somebody holding a stolen session would do.
   */
  async removeFactor(factorId: string): Promise<void> {
    await this.api.sendVoid({
      method: "DELETE",
      path: `v1/auth/mfa/factors/${encodeURIComponent(factorId)}`,
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * Asks for a challenge in front of something sensitive.
   *
   * Null when the user has no factor to be asked for, and a caller that gets null should go
   * ahead: the same absence is what lets them past the check on the other side. Submitting
   * one swaps the held access token for a fresher one carrying the new factor age, so the
   * next call the customer makes is already allowed.
   */
  async startStepUp(): Promise<MfaChallenge | null> {
    const response = await this.api.sendOptional(mfaChallengeSchema, {
      method: "POST",
      path: "v1/auth/mfa/step-up",
      accessToken: await this.sessions.requireToken(),
    });
    if (response === null) return null;
    return new MfaChallenge(
      response.challengeId,
      response.purpose,
      response.factors,
      new Date(response.expiresAt),
      async (submission: MfaSubmission) => {
        const completed = await this.api.send(stepUpCompletedSchema, {
          method: "POST",
          path: "v1/auth/mfa/step-up/verify",
          body: {
            challengeId: response.challengeId,
            factor: submission.factor,
            code: submission.code,
          },
          accessToken: await this.sessions.requireToken(),
        });
        return this.sessions.replaceToken(
          completed.accessToken,
          new Date(completed.accessTokenExpiresAt),
        );
      },
    );
  }
}
