import type { Clock } from "@idenzy/core/time/clock";
import type { Valkey } from "iovalkey";

/**
 * Sessions revoked within the last max-TTL window (PROJECT.md 4.2).
 *
 * This is what makes a 5-minute access token behave like a 60-second one for
 * revocation, without the per-minute refresh storm Clerk pays for. A server SDK can
 * check this cheaply, so a revoked session stops working in about a second instead of
 * up to five minutes.
 *
 * Entries only need to outlive the longest possible token, so the TTL is the token
 * lifetime, not forever. That keeps the set small enough to stay a cheap lookup.
 */
export class RevocationSet {
  constructor(
    private readonly valkey: Valkey,
    private readonly clock: Clock,
    private readonly maxTokenTtlSeconds: number,
  ) {}

  private key(projectId: string): string {
    return `revoked:${projectId}`;
  }

  async revoke(projectId: string, sessionId: string): Promise<void> {
    const key = this.key(projectId);
    await this.valkey
      .multi()
      .zadd(key, this.clock.nowMs(), sessionId)
      .expire(key, this.maxTokenTtlSeconds * 2)
      .exec();
  }

  async isRevoked(projectId: string, sessionId: string): Promise<boolean> {
    const score = await this.valkey.zscore(this.key(projectId), sessionId);
    return score !== null;
  }

  /**
   * The current set, for the signed cacheable endpoint server SDKs poll.
   *
   * Prunes anything older than the max token lifetime first: those sessions cannot have
   * a live token any more, so keeping them only grows the payload.
   */
  async snapshot(projectId: string): Promise<readonly string[]> {
    const key = this.key(projectId);
    const cutoff = this.clock.nowMs() - this.maxTokenTtlSeconds * 1000;
    await this.valkey.zremrangebyscore(key, 0, cutoff);
    return this.valkey.zrange(key, 0, -1);
  }
}
