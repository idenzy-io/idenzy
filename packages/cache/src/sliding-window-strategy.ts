import type { Clock } from "@idenzy/core/time/clock";
import type { Valkey } from "iovalkey";
import {
  type RateLimitDecision,
  type RateLimitRule,
  RateLimitStrategy,
} from "./rate-limit-strategy.js";

/**
 * Sliding window over a sorted set.
 *
 * Chosen over a fixed window for the authentication paths because a fixed window lets an
 * attacker send 2x the limit across a boundary, which for password attempts is exactly
 * the burst that matters.
 */
export class SlidingWindowStrategy extends RateLimitStrategy {
  override readonly name = "sliding";

  constructor(
    private readonly valkey: Valkey,
    clock: Clock,
  ) {
    super(clock);
  }

  protected override async evaluate(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const now = this.clock.nowMs();
    const windowStart = now - rule.windowSeconds * 1000;

    const results = await this.valkey
      .multi()
      .zremrangebyscore(key, 0, windowStart)
      .zadd(key, now, `${now}-${Math.random()}`)
      .zcard(key)
      .expire(key, rule.windowSeconds)
      .exec();

    const countEntry = results?.[2];
    const count = typeof countEntry?.[1] === "number" ? countEntry[1] : 0;
    const allowed = count <= rule.limit;

    return {
      allowed,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: allowed ? 0 : rule.windowSeconds,
    };
  }
}
