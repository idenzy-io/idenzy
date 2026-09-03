import { MfaRequiredError } from "@idenzy/core/errors";
import type { AuthMethod } from "@idenzy/protocol/enums/auth";
import type { User } from "../entities/user.js";

export interface AuthenticatedSubject {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  readonly requiresMfa: boolean;
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
  ) {}

  abstract readonly method: AuthMethod;

  /** Prove the subject's identity. Throws an IdenzyError on failure; never returns null. */
  protected abstract verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject>;

  async authenticate(context: FlowContext, credentials: unknown): Promise<IssuedSession> {
    const subject = await this.verify(context, credentials);
    this.assertMfaSatisfied(subject);
    await this.hooks.beforeSignIn(context, subject.userId);
    const session = await this.sessions.issueSession(context, subject);
    await this.audit.record(context, "session.created", {
      method: this.method,
      requiresMfa: subject.requiresMfa,
    });
    return session;
  }

  /**
   * A subject that still owes a second factor never reaches session creation.
   *
   * Inherited rather than checked per flow, because a flow that forgets this issues a
   * fully valid session to someone who proved one factor. Phase 2 replaces the throw
   * with an MFA challenge; the position in the ordering does not move.
   */
  protected assertMfaSatisfied(subject: AuthenticatedSubject): void {
    if (subject.requiresMfa) {
      throw new MfaRequiredError({ detail: { userId: subject.userId, method: this.method } });
    }
  }
}
