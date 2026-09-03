import { authOutcomeSchema } from "@idenzy/protocol/schemas/mfa";
import { IdenzyTransportError } from "../errors.js";
import type { ApiClient, RequestSpec } from "../http/api-client.js";
import { type AuthResult, MfaChallenge, type MfaSubmission } from "../mfa/auth-result.js";
import { proveWithPasskey } from "../mfa/passkey-ceremony.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";

/**
 * Base for every flow that ends in a session.
 *
 * The inherited part is the ending, and that is the whole reason this class exists. A flow
 * that posted its credentials and returned the body would look like it worked: the customer
 * gets a user object, their form navigates, and the SDK is still signed out. Adopting is not
 * a step a subclass can be trusted to remember, so it is not one a subclass is given
 * (PROJECT.md 7.2.5).
 *
 * The other half it owns is the challenge. A sign-in can end at a second factor, and the call
 * that answers one creates the session, so it belongs on the same path with the same device
 * name and the same adoption. A flow that returned the challenge raw would leave the customer
 * to assemble that call, and a session adopted by hand is a session the manager never sees.
 */
export abstract class SessionFlow {
  protected constructor(
    protected readonly api: ApiClient,
    protected readonly sessions: SessionManager,
  ) {}

  /**
   * Template method: post, parse, adopt or challenge. Subclasses choose the route and body.
   *
   * The device name rides here rather than at each call site, because these are the calls in
   * the SDK that create a session and therefore the ones the server reads it on.
   */
  protected async establish(spec: RequestSpec): Promise<AuthResult> {
    const outcome = await this.api.send(authOutcomeSchema, { ...spec, namesDevice: true });
    if (outcome.status === "authenticated") {
      return { status: "authenticated", session: this.sessions.adopt(outcome) };
    }
    return {
      status: "mfa_required",
      challenge: new MfaChallenge(
        outcome.challengeId,
        outcome.purpose,
        outcome.factors,
        new Date(outcome.expiresAt),
        (submission) => this.completeMfa(outcome.challengeId, submission),
        (challengeId) => proveWithPasskey(this.api, challengeId),
      ),
    };
  }

  /**
   * Answers a challenge, which is the request that finally creates the session.
   *
   * A second challenge in reply is not a case the customer has to handle: the server issues
   * one challenge per sign-in, so anything else is a mismatch between this client and the API
   * it is talking to, which is what `IdenzyTransportError` is for.
   */
  private async completeMfa(challengeId: string, submission: MfaSubmission): Promise<Session> {
    const outcome = await this.api.send(authOutcomeSchema, {
      method: "POST",
      path: "v1/auth/mfa/verify",
      body: { challengeId, ...submission },
      namesDevice: true,
    });
    if (outcome.status !== "authenticated") {
      throw new IdenzyTransportError("A second factor was answered and another was demanded.", {
        status: 200,
      });
    }
    return this.sessions.adopt(outcome);
  }
}
