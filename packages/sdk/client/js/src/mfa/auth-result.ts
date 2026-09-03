import type { MfaChallengePurpose, MfaFactorType } from "@idenzy/protocol/enums/auth";
import type { MfaProof } from "@idenzy/protocol/schemas/mfa";
import type { Session } from "../session/session.js";

/**
 * What a caller submits against a challenge.
 *
 * The protocol's own union rather than a local shape, because a proof is not one thing: a
 * code for an authenticator or a recovery sheet, a signed assertion for a passkey. The
 * passkey variant is not hand-assembled in practice, since `submitPasskey` runs the
 * ceremony and builds it.
 */
export type MfaSubmission = MfaProof;

/**
 * A sign-in that stopped at a second factor.
 *
 * It carries `submit` rather than leaving the caller to find the right method, because the
 * challenge id, the transport mode and the device name all have to travel with the answer,
 * and a customer assembling that call themselves is a customer who can get one of them wrong.
 * Everything the UI needs to prompt with is on the object: `factors` is ordered strongest
 * first, so the first is what to ask for and the rest belong behind "try another way".
 */
export class MfaChallenge {
  constructor(
    readonly challengeId: string,
    readonly purpose: MfaChallengePurpose,
    readonly factors: readonly MfaFactorType[],
    readonly expiresAt: Date,
    private readonly complete: (submission: MfaSubmission) => Promise<Session>,
    private readonly ceremony: (challengeId: string) => Promise<MfaSubmission>,
  ) {}

  submit(submission: MfaSubmission): Promise<Session> {
    return this.complete(submission);
  }

  /**
   * Answers with a passkey, running the ceremony first.
   *
   * Its own method because a passkey proof is not something a customer types: it is two
   * round trips and a `navigator.credentials.get` between them, and asking every caller to
   * assemble it would be asking them to reimplement `PasskeyFlow`. A cancelled prompt
   * arrives as the browser's own `DOMException`, untranslated, as everywhere else here.
   */
  async submitPasskey(): Promise<Session> {
    return this.complete(await this.ceremony(this.challengeId));
  }
}

/**
 * What every way in answers with.
 *
 * A union rather than a session and a nullable challenge, so a customer whose project turns
 * MFA on finds out at their next build rather than at their users' next sign-in. The flows
 * that can never challenge return it too: which those are is our business and changes, and a
 * caller that had branched on knowing would be the one left broken.
 */
export type AuthResult =
  | { readonly status: "authenticated"; readonly session: Session }
  | { readonly status: "mfa_required"; readonly challenge: MfaChallenge };

/** The session, or the same refusal a caller would otherwise write by hand five times. */
export function sessionOrThrow(result: AuthResult): Session {
  if (result.status !== "authenticated") {
    throw new MfaChallengePending(result.challenge);
  }
  return result.session;
}

/**
 * Thrown by `sessionOrThrow` for the caller who wants one line rather than a branch.
 *
 * It carries the challenge, so a handler can still finish the sign-in. Not an `IdenzyApiError`:
 * nothing failed, and giving it a code would put it in the same `catch` as a wrong password.
 */
export class MfaChallengePending extends Error {
  constructor(readonly challenge: MfaChallenge) {
    super("A second factor is required to finish signing in.");
    this.name = "MfaChallengePending";
  }
}
