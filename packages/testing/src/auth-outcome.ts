import { InternalError } from "@idenzy/core/errors";
import type { AuthOutcome, IssuedSession } from "@idenzy/domain/ports/auth-flow";

/**
 * Narrows an authentication to the session it produced.
 *
 * Every flow answers with a session or with the second factor it still owes, which is
 * what a caller has to handle and therefore what a test has to state. This exists so a
 * test that expects a session says so in one word, and fails loudly rather than reading
 * `undefined` off a challenge when a change makes a flow start asking for one.
 *
 * It lives here rather than in the domain deliberately: production code that could
 * unwrap an outcome without deciding what to do with the other half is production code
 * that can skip a second factor.
 */
export function sessionOf(outcome: AuthOutcome): IssuedSession {
  if (outcome.kind !== "session") {
    throw new InternalError({
      detail: { reason: "expected a session, got an mfa challenge", outcome: outcome.kind },
    });
  }
  return outcome.session;
}

/** The other half, for the tests whose subject is the challenge. */
export function challengeOf(outcome: AuthOutcome): AuthOutcome & { kind: "mfa" } {
  if (outcome.kind !== "mfa") {
    throw new InternalError({
      detail: { reason: "expected an mfa challenge, got a session", outcome: outcome.kind },
    });
  }
  return outcome;
}
