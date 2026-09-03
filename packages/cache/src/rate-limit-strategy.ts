import type { Clock } from "@idenzy/core/time/clock";

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * Rate limiting (PROJECT.md 4.9).
 *
 * The base owns the key namespace so two strategies can never collide on a key, and
 * fixes the fail-open decision in one place: if the backing store is unreachable we
 * allow the request and say so, because a Valkey outage must not become a total auth
 * outage. That is a deliberate availability-over-enforcement trade, and the edge WAF
 * plus the Postgres fallback are the second line (PROJECT.md 6.3).
 */
export abstract class RateLimitStrategy {
  protected constructor(protected readonly clock: Clock) {}

  abstract readonly name: string;
  protected abstract evaluate(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;

  async check(scope: string, identifier: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const key = `rl:${this.name}:${scope}:${identifier}`;
    try {
      return await this.evaluate(key, rule);
    } catch {
      return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
    }
  }

  /**
   * The same window, without the fail-open.
   *
   * For the limits whose failure mode is a bill rather than a lockout. A sign-in attempt
   * we could not count is worth allowing, because the alternative is an outage in the
   * cache taking authentication down with it. A paid SMS we could not count is not:
   * allowing it turns a Valkey outage into an unmetered send window, which is exactly
   * the window a pumping scheme is waiting for (PROJECT.md 4.8).
   *
   * The store's error is propagated rather than turned into a decision here, so the
   * caller chooses what an unanswerable check means to its own users.
   */
  checkStrictly(
    scope: string,
    identifier: string,
    rule: RateLimitRule,
  ): Promise<RateLimitDecision> {
    return this.evaluate(`rl:${this.name}:${scope}:${identifier}`, rule);
  }
}
