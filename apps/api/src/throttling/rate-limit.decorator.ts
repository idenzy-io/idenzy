import type { RateLimitRule } from "@idenzy/cache/rate-limit-strategy";
import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT = "idenzy:rate-limit";

/**
 * A limit on the account being attacked, rather than on whoever is attacking it.
 *
 * `from` names the body fields the subject may appear under, first present wins, because
 * one route serves more than one identifier: an OTP start carries `email` or `phone`
 * depending on the channel. A request naming none is limited by address alone, which is
 * the honest answer — there is nothing to spray at.
 */
export interface SubjectRateLimitRule extends RateLimitRule {
  readonly from: readonly string[];
}

export interface RateLimitSpec {
  /**
   * Per caller, and always present. This is the burst control: it bounds what one source
   * can do to the whole project, whatever accounts it names.
   */
  readonly ip: RateLimitRule;
  /**
   * Per account named in the request. This is the spraying control, and it is the half a
   * limiter without it silently lacks: an attacker with a thousand addresses stays under
   * every per-address limit while making a thousand attempts against one victim.
   */
  readonly subject?: SubjectRateLimitRule;
}

/**
 * Declares what this route costs a caller (PROJECT.md 4.5, 4.9).
 *
 * Opt-in, like `@RequireSession`, so adding an unthrottled endpoint is a visible absence
 * in a diff rather than a guard registration nobody remembers. The numbers live on the
 * route because they are a property of what the route does: a password attempt and a
 * paid SMS do not want the same ceiling, and a single global figure would be set for the
 * most expensive one and be useless for the rest.
 */
export const RateLimit = (spec: RateLimitSpec): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT, spec);
