import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { AuthOutcome } from "@idenzy/domain/ports/auth-flow";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { AuthOutcome as AuthOutcomeBody } from "@idenzy/protocol/schemas/mfa";

/**
 * The one way a flow's result becomes a response body.
 *
 * Written once because every route that signs somebody in returns the same union, and a
 * route that presented only the session half would answer a challenge with `undefined`
 * fields rather than with the challenge. Sharing it is also what keeps the discriminant
 * spelled the same way on eight endpoints.
 */
export function presentOutcome(outcome: AuthOutcome): AuthOutcomeBody {
  if (outcome.kind === "mfa") {
    return {
      status: "mfa_required",
      challengeId: outcome.challenge.challengeId,
      purpose: outcome.challenge.purpose,
      factors: [...outcome.challenge.factors],
      expiresAt: outcome.challenge.expiresAt.toISOString(),
    };
  }
  const issued = outcome.session;
  return {
    status: "authenticated",
    user: issued.user.toPublic(),
    sessionId: PublicId.encode(IdPrefix.Session, issued.sessionId).value,
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    refreshToken: issued.refreshToken,
  };
}
