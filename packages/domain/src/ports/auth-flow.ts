import type { AuthMethod, MfaChallengePurpose, MfaFactorType } from "@idenzy/protocol/enums/auth";
import type { User } from "../entities/user.js";

export interface AuthenticatedSubject {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  /**
   * When a factor was proved, for the `fva` claim, or null when only one was.
   *
   * Set by a flow that is itself multi-factor rather than by the gate, because the gate
   * only ever sees the flows that owe a second one. A passkey with user verification is
   * the case that matters: possession and verification in one ceremony, so asking for a
   * code afterwards asks the user to prove something they already proved.
   */
  readonly factorVerifiedAt: Date | null;
}

export interface FlowContext {
  readonly projectId: string;
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /**
   * What the client asked this device to be called in the user's session list. Null when it
   * said nothing, which is most callers: a server SDK has no device to name.
   *
   * Display text and nothing else. It is chosen by whoever holds the client, so it is not
   * evidence of anything and no check may read it.
   */
  readonly deviceName: string | null;
  /**
   * The caller's preferred language, for anything we send them. Null when the request
   * did not say, which is not the same as English: the renderer decides the fallback,
   * because the fallback chain is a template concern and not a request one.
   */
  readonly locale: string | null;
  /**
   * A CAPTCHA or app-attestation token the client solved for, or null.
   *
   * Carried on the context rather than on the schema of the one route that reads it
   * today, for the same reason the device name is: the next route that spends money on a
   * request is one somebody would add without the field, and a token that has to be
   * threaded through a body is a token a new flow forgets.
   */
  readonly attestation: string | null;
}

/**
 * What every successful authentication produces.
 *
 * Returned by the issuer rather than assembled per flow, so no flow can hand back an
 * access token without the session row and refresh token that make it revocable.
 */
export interface IssuedSession {
  readonly sessionId: string;
  readonly userId: string;
  /** Carried here so presenting the result never needs a second read of the row. */
  readonly user: User;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
}

export interface SessionIssuer {
  issueSession(context: FlowContext, subject: AuthenticatedSubject): Promise<IssuedSession>;
}

/** A proved first factor waiting on a second. Carries no credential of any kind. */
export interface IssuedChallenge {
  readonly challengeId: string;
  readonly purpose: MfaChallengePurpose;
  /** What this user can answer with, strongest first. */
  readonly factors: readonly MfaFactorType[];
  readonly expiresAt: Date;
}

/**
 * What an authentication ends as.
 *
 * A union rather than a session with a nullable field, so a caller that ignores the
 * second case does not compile. Every flow returns this shape, including the ones that
 * can never challenge: a controller branching on `kind` should not have to know which
 * those are, and one that does know is one that stops being right when MFA reaches a
 * flow it was written before.
 */
export type AuthOutcome =
  | { readonly kind: "session"; readonly session: IssuedSession }
  | { readonly kind: "mfa"; readonly challenge: IssuedChallenge };

/**
 * Decides whether a proved first factor is enough, and mints the challenge when it is not.
 *
 * A port rather than a method on the base, because the answer needs the user's enrolled
 * factors and a challenge table, and the domain layer has neither. What the base owns is
 * where it is consulted: after `verify` and before anything that creates a session.
 */
export interface MfaGate {
  challengeFor(
    context: FlowContext,
    subject: AuthenticatedSubject,
  ): Promise<IssuedChallenge | null>;
}

export interface FlowHooks {
  beforeSignIn(context: FlowContext, userId: string): Promise<void>;
}

export interface FlowAudit {
  record(
    context: FlowContext,
    action: string,
    meta: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

/**
 * The base every way of signing in extends (PROJECT.md 9.5).
 *
 * This is the most important abstraction in the system. Every flow (password, OTP,
 * magic link, passkey, OAuth, anonymous, ID-token exchange) ends in the same inherited
 * `authenticate` path, so hook invocation, MFA gating, session creation, audit and
 * event ordering are written once and cannot be reordered or skipped by a new flow.
 *
 * A subclass implements `verify` only: prove who the subject is. It never creates a
 * session itself.
 */
export abstract class AuthFlow {
  protected constructor(
    protected readonly sessions: SessionIssuer,
    protected readonly hooks: FlowHooks,
    protected readonly audit: FlowAudit,
    protected readonly mfa: MfaGate,
  ) {}

  abstract readonly method: AuthMethod;

  /** Prove the subject's identity. Throws an IdenzyError on failure; never returns null. */
  protected abstract verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject>;

  async authenticate(context: FlowContext, credentials: unknown): Promise<AuthOutcome> {
    const subject = await this.verify(context, credentials);

    // Consulted before the hooks and before anything that creates a session. Inherited
    // rather than checked per flow, because a flow that forgot it would hand a fully
    // valid session to someone who proved one factor of two.
    const challenge = await this.mfa.challengeFor(context, subject);
    if (challenge !== null) {
      await this.audit.record(context, "mfa.challenged", {
        method: this.method,
        factors: [...challenge.factors],
      });
      return { kind: "mfa", challenge };
    }

    await this.hooks.beforeSignIn(context, subject.userId);
    const session = await this.sessions.issueSession(context, subject);
    await this.audit.record(context, "session.created", { method: this.method });
    return { kind: "session", session };
  }
}
