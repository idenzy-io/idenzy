/** The commands a due set needs. A real `Valkey` satisfies it structurally. */
export interface DueSetCommands {
  zadd(key: string, ...args: (string | number)[]): Promise<unknown>;
  zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
    withScores: "WITHSCORES",
    limit: "LIMIT",
    offset: number,
    count: number,
  ): Promise<string[]>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  zcard(key: string): Promise<number>;
}

/** One member that is due, with the score it was read at. */
export interface DueEntry {
  readonly member: string;
  /** Milliseconds since the epoch. Hand it back to `done` unchanged. */
  readonly score: number;
}

/**
 * Removes a member only if its score is still the one the consumer read.
 *
 * A member marked again while it was being worked on has a newer score, and removing it
 * anyway would drop the newer signal on the floor — the consumer read the database before
 * whatever the new mark was about.
 */
const DONE_IF_UNCHANGED = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == ARGV[2] then
  return redis.call('ZREM', KEYS[1], ARGV[1])
end
return 0`;

/**
 * A set of things that want attention, each with the earliest time it should get it
 * (ADR-0017).
 *
 * A sorted set keyed by member, so a thing marked a thousand times before the consumer gets
 * to it is one entry and one piece of work: coalescing is the data structure, not a step
 * anybody has to remember. Marking keeps the **latest** time (`GT`), so a signal is never
 * brought forward past a deferral and never lost behind an older mark.
 *
 * It holds hints and nothing else. Nothing here is durable across a restart — the compose
 * file runs Valkey with no persistence, on purpose — and nothing needs to be: every consumer
 * re-reads its truth from Postgres, and a periodic pass there catches whatever a lost mark
 * would have woken.
 *
 * Errors propagate; the producer's port swallows them and the consumer logs them.
 */
export class DueSet {
  constructor(
    private readonly commands: DueSetCommands,
    private readonly key: string,
  ) {}

  /** Wants attention no earlier than `at`. Keeps a later time already recorded. */
  async mark(member: string, at: Date): Promise<void> {
    await this.commands.zadd(this.key, "GT", at.getTime(), member);
  }

  /** Up to `limit` members due at or before `now`, earliest first. Removes nothing. */
  async due(now: Date, limit: number): Promise<readonly DueEntry[]> {
    const flat = await this.commands.zrangebyscore(
      this.key,
      "-inf",
      now.getTime(),
      "WITHSCORES",
      "LIMIT",
      0,
      limit,
    );
    const entries: DueEntry[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const member = flat[i];
      const score = Number(flat[i + 1]);
      if (member !== undefined && Number.isFinite(score)) entries.push({ member, score });
    }
    return entries;
  }

  /** Worked on. Removed unless it was marked again meanwhile, in which case it stays. */
  async done(entry: DueEntry): Promise<void> {
    await this.commands.eval(DONE_IF_UNCHANGED, 1, this.key, entry.member, String(entry.score));
  }

  /** Not now: try again no earlier than `until`. */
  async defer(entry: DueEntry, until: Date): Promise<void> {
    await this.commands.zadd(this.key, "XX", "GT", until.getTime(), entry.member);
  }

  async size(): Promise<number> {
    return await this.commands.zcard(this.key);
  }
}
