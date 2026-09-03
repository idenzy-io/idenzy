import { MfaFactorInvalidError } from "@idenzy/core/errors";
import type { AuthMethod, MfaFactorType } from "@idenzy/protocol/enums/auth";
import type { MfaProof } from "@idenzy/protocol/schemas/mfa";
import type { FlowContext } from "./auth-flow.js";

/**
 * A way of proving a second factor (PROJECT.md 4.5, 7.2.3).
 *
 * The base is small because most of what an MFA implementation gets wrong is not the
 * arithmetic. It owns two things a subclass cannot then undo.
 *
 * One refusal, whatever went wrong. `check` returns a boolean and only the base throws,
 * so a wrong code, a code from a step already spent, a code already crossed off a
 * recovery sheet and a factor the user never enrolled are indistinguishable from
 * outside. That matters more here than at the door: everybody who reaches a challenge
 * has already got past a first factor, which is exactly the position a stolen password
 * puts an attacker in, and a distinguishable answer would tell them what the account
 * holds before they decide what to steal next.
 *
 * And `amr` comes from the factor that ran. `prove` returns the method rather than
 * taking it, so the claim on the resulting session says what was actually proved and not
 * what the caller believed it asked for.
 */
export abstract class MfaFactor {
  abstract readonly type: MfaFactorType;

  /** What this factor contributes to the session's `amr` claim when it succeeds. */
  abstract readonly method: AuthMethod;

  /**
   * Whether holding this factor is itself a reason to be challenged.
   *
   * True for something enrolled *as* a second factor, which is what turns MFA on for an
   * account. False for a passkey, which is a way to answer a challenge rather than a
   * reason for one: a credential somebody enrolled to sign in with must not silently
   * start demanding itself on top of their password. False for recovery codes too, since
   * a sheet on its own has nothing to fall back from.
   *
   * The gate reads this to decide whether to challenge at all; `enrolled` decides what
   * the challenge may be answered with. Collapsing the two would make enrolling a passkey
   * a change to how every other sign-in behaves.
   */
  abstract readonly demandsChallenge: boolean;

  /**
   * Whether the user holds one of these.
   *
   * Read when a challenge is offered, so the customer's UI knows what to prompt for, and
   * deliberately never read by `prove`: a factor the user does not hold has to fail the
   * same way a wrong code does.
   */
  abstract enrolled(context: FlowContext, userId: string): Promise<boolean>;

  /**
   * Spend the proof and say whether it was good.
   *
   * Returns rather than throws, and spends before it answers. A code that was checked
   * and not consumed is a code the next request can present again, so a factor whose
   * proof is single use consumes it in the same statement that reads it.
   *
   * The proof is the whole union, not this factor's half of it. Every implementation
   * starts by refusing one meant for something else, which is one line and is also what
   * narrows the type. The registry dispatches by factor already, so that line should be
   * unreachable; it is there because "should be" is not a guarantee, and the conformance
   * suite has a case for it.
   */
  protected abstract check(context: FlowContext, userId: string, proof: MfaProof): Promise<boolean>;

  /**
   * Template method. The one door, and the one refusal.
   *
   * A proof is not one shape: a code is a string and a passkey assertion is a signed
   * object several hundred bytes long. Taking the union rather than a string is what lets
   * a ceremony be a factor at all.
   */
  async prove(context: FlowContext, userId: string, proof: MfaProof): Promise<AuthMethod> {
    if (!(await this.check(context, userId, proof))) {
      // The reason stays in `detail`, which never reaches a response body.
      throw new MfaFactorInvalidError({ detail: { factor: this.type, userId } });
    }
    return this.method;
  }
}
