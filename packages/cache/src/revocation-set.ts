import type { Clock } from "@idenzy/core/time/clock";

/**
 * What a revoked session looks like to something holding a token for it.
 *
 * Ids here are the public ones the token carries (`ses_`, `usr_`), never database uuids.
 * The snapshot is published to customers, so a row identifier that leaked into it would
 * stay leaked, and the SDK compares against the token's own `sid` in any case.
 */
export interface UserWatermark {
  readonly userId: string;
  /** Unix seconds. A token is dead where its `iat` is strictly below this. */
  readonly revokedBefore: number;
}

/** The whole set for one project, which is what the published endpoint serves. */
export interface RevocationSnapshot {
  readonly sessions: readonly string[];
  readonly users: readonly UserWatermark[];
  readonly projectRevokedBefore: number | null;
}

/** Who a token names, in the terms this set is keyed by. */
export interface TokenSubject {
  readonly sessionId: string;
  readonly userId: string;
  /** The token's `iat`, in unix seconds. */
  readonly issuedAt: number;
}

/**
 * The commands this needs, declared rather than taken from all of iovalkey's surface.
 *
 * A real `Valkey` satisfies it structurally, and a test can implement seven methods
 * instead of several hundred. It also states the dependency honestly: this is a sorted
 * set and two string keys, not an open connection to do anything with.
 */
export interface RevocationCommands {
  /** Variadic score-member pairs, so revoking several sessions is one round trip. */
  zadd(key: string, ...scoreMembers: (string | number)[]): Promise<unknown>;
  zscore(key: string, member: string): Promise<string | null>;
  zremrangebyscore(key: string, min: string, max: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number, withScores: "WITHSCORES"): Promise<string[]>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Sessions and users revoked recently enough to still hold a live access token
 * (PROJECT.md 4.2, ADR-0009).
 *
 * This is what lets a five-minute token behave like a sixty-second one for revocation
 * without the per-minute refresh storm that buys the same thing. It is published whole
 * on a signed endpoint and checked by a server SDK against an in-process copy, so a
 * revocation check on a customer's request path costs no network call.
 *
 * Three shapes because one cannot carry all three cases. A session id revokes one
 * session. A user watermark revokes everything that user held before an instant, which
 * is what signing out everywhere and a password reset need and what writing one entry
 * per session would not bound. A project watermark is the same for a key compromise.
 *
 * Everything is retained for one access token lifetime plus skew and no longer: a token
 * minted immediately before a revocation expires one lifetime later, so nothing older
 * can still be presented. That bound is what keeps the set small enough to publish.
 *
 * Errors propagate. The call sites want different things from a failure, and ADR-0009
 * settles both: a write is backed by the outbox event enqueued in the same transaction,
 * so losing one delays propagation rather than dropping a revocation, and a read on our
 * side is an accelerator in front of the session row that remains the authority.
 */
export class RevocationSet {
  constructor(
    private readonly commands: RevocationCommands,
    private readonly clock: Clock,
    /**
     * How long an entry has to outlive the revocation that wrote it: the longest access
     * token lifetime this deployment issues, plus the skew a verifier tolerates.
     */
    private readonly retentionSeconds: number,
  ) {}

  /**
   * Ends specific sessions, as of the instant they were revoked.
   *
   * The instant is passed rather than read from the clock, and that is what makes a replay
   * free: the reconciler re-applies the same event to the same score, so an entry ages out
   * on schedule instead of being pushed forward every time it is seen again.
   *
   * Called after the transaction has committed, never before. A write that preceded the
   * commit could revoke a session the transaction then rolled back, and a false entry is
   * not self-correcting: the set is keyed by session id, and refreshing mints a new
   * access token for the same session, so nothing the client does clears it (ADR-0009).
   */
  async revokeSessions(
    projectId: string,
    sessionIds: readonly string[],
    revokedAt: Date,
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    const key = this.sessionsKey(projectId);
    const at = secondsOf(revokedAt);
    await this.commands.zadd(key, ...sessionIds.flatMap((id) => [at, id]));
    await Promise.all([
      this.prune(key, this.seconds()),
      this.commands.expire(key, this.retentionSeconds),
    ]);
  }

  /**
   * Ends everything a user holds, as one entry rather than one per session.
   *
   * The watermark is floored to the second and compared strictly, so a token issued in
   * the same second as the revocation survives it. That is deliberate: `iat` is only
   * second-accurate, so the alternative to under-revoking by under a second is revoking
   * tokens minted after the event, and ADR-0009 says which of those two we take.
   */
  async revokeUser(projectId: string, userId: string, revokedAt: Date): Promise<void> {
    const key = this.usersKey(projectId);
    const at = secondsOf(revokedAt);
    await this.commands.zadd(key, at, userId);
    await Promise.all([
      this.prune(key, this.seconds()),
      this.commands.expire(key, this.retentionSeconds),
    ]);
  }

  /** The same for every session in a project, which is what a key compromise needs. */
  async revokeProject(projectId: string, revokedAt: Date): Promise<void> {
    await this.commands.set(
      this.projectKey(projectId),
      String(secondsOf(revokedAt)),
      "EX",
      this.retentionSeconds,
    );
  }

  /**
   * Whether a token is dead, by any of the three routes.
   *
   * An entry older than the retention window answers false. Any token it could have
   * killed has expired by then, so keeping it would only be a lie about a session that
   * is not usable anyway.
   */
  async isRevoked(projectId: string, subject: TokenSubject): Promise<boolean> {
    const cutoff = this.seconds() - this.retentionSeconds;
    const [session, user, project] = await Promise.all([
      this.commands.zscore(this.sessionsKey(projectId), subject.sessionId),
      this.commands.zscore(this.usersKey(projectId), subject.userId),
      this.commands.get(this.projectKey(projectId)),
    ]);

    const revokedAt = score(session);
    if (revokedAt !== null && revokedAt >= cutoff) return true;
    return (
      before(subject.issuedAt, score(user), cutoff) ||
      before(subject.issuedAt, score(project), cutoff)
    );
  }

  /**
   * The current set, for the signed endpoint a server SDK polls.
   *
   * Pruned on the way out as well as on the way in, because a project that stopped
   * revoking should stop publishing what it revoked rather than serve a window that
   * empties only when something writes to it again.
   */
  async snapshot(projectId: string): Promise<RevocationSnapshot> {
    const now = this.seconds();
    const cutoff = now - this.retentionSeconds;
    const sessionsKey = this.sessionsKey(projectId);
    const usersKey = this.usersKey(projectId);
    await Promise.all([this.prune(sessionsKey, now), this.prune(usersKey, now)]);

    const [sessions, users, project] = await Promise.all([
      this.commands.zrange(sessionsKey, 0, -1, "WITHSCORES"),
      this.commands.zrange(usersKey, 0, -1, "WITHSCORES"),
      this.commands.get(this.projectKey(projectId)),
    ]);

    const projectRevokedBefore = score(project);
    return {
      sessions: members(sessions, cutoff).map((entry) => entry.member),
      users: members(users, cutoff).map((entry) => ({
        userId: entry.member,
        revokedBefore: entry.score,
      })),
      projectRevokedBefore:
        projectRevokedBefore !== null && projectRevokedBefore >= cutoff
          ? projectRevokedBefore
          : null,
    };
  }

  /**
   * Drops what can no longer matter.
   *
   * Exclusive on the cutoff, so an entry landing exactly on the boundary is kept. The
   * cost of one extra entry is nothing; the cost of dropping one a second early is a
   * revocation that stops being published while a token it covers is still live.
   */
  private async prune(key: string, now: number): Promise<void> {
    await this.commands.zremrangebyscore(key, "-inf", `(${now - this.retentionSeconds}`);
  }

  private seconds(): number {
    return Math.floor(this.clock.nowMs() / 1000);
  }

  private sessionsKey(projectId: string): string {
    return `rev:s:${projectId}`;
  }

  private usersKey(projectId: string): string {
    return `rev:u:${projectId}`;
  }

  private projectKey(projectId: string): string {
    return `rev:p:${projectId}`;
  }
}

/** Valkey answers scores as strings, and a missing member as null. */
function score(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Floored, because `iat` is only accurate to the second and the comparison is against it. */
function secondsOf(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

/** Strictly below, so a token issued in the watermark's own second survives it. */
function before(issuedAt: number, watermark: number | null, cutoff: number): boolean {
  return watermark !== null && watermark >= cutoff && issuedAt < watermark;
}

/** `WITHSCORES` returns a flat member, score, member, score list. */
function members(flat: readonly string[], cutoff: number): readonly Entry[] {
  const entries: Entry[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    const member = flat[index];
    const parsed = score(flat[index + 1] ?? null);
    if (member === undefined || parsed === null || parsed < cutoff) continue;
    entries.push({ member, score: parsed });
  }
  return entries;
}

interface Entry {
  readonly member: string;
  readonly score: number;
}
