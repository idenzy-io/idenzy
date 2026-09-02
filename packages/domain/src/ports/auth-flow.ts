import type { AuthMethod } from "@idenzy/protocol/enums/auth";

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
}

export interface SessionIssuer {
  issueSession(context: FlowContext, subject: AuthenticatedSubject): Promise<string>;
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

  async authenticate(context: FlowContext, credentials: unknown): Promise<string> {
    const subject = await this.verify(context, credentials);
    await this.hooks.beforeSignIn(context, subject.userId);
    const sessionId = await this.sessions.issueSession(context, subject);
    await this.audit.record(context, "session.created", {
      method: this.method,
      requiresMfa: subject.requiresMfa,
    });
    return sessionId;
  }
}
