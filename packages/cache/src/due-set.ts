/** The commands a due set needs. A real `Valkey` satisfies it structurally. */
export interface DueSetCommands {
  zadd(key: string, ...args: (string | number)[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  zcard(key: string): Promise<number>;
}

/** One member taken for work, with what `done` needs to know whether it was marked since. */
export interface DueEntry {
  readonly member: string;
  /** Milliseconds since the epoch: when it fell due, or, once claimed, when the lease ends. */
  readonly score: number;
  /** How many times it had been marked when it was read. Hand it back to `done` unchanged. */
  readonly version: number;
}

/**
 * Marks a member due no earlier than a time, keeping a later time already there, and counts the
 * mark. The count is what `done` compares, because a claimed member's score is its lease end and
 * a mark arriving mid-work — at a time earlier than that — cannot move it.
 */
const MARK = `
redis.call('ZADD', KEYS[1], 'GT', ARGV[1], ARGV[2])
return redis.call('HINCRBY', KEYS[2], ARGV[2], 1)`;

/**
 * Takes up to ARGV[2] members due by ARGV[1] and pushes each one's score out to the lease end
 * ARGV[3], in one step, so a second consumer reading the same set a moment later finds them not
 * due. Answers member, lease, version triples.
 */
const CLAIM = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
local out = {}
for _, member in ipairs(due) do
  redis.call('ZADD', KEYS[1], 'XX', ARGV[3], member)
  out[#out + 1] = member
  out[#out + 1] = ARGV[3]
  out[#out + 1] = redis.call('HGET', KEYS[2], member) or '0'
end
return out`;

/**
 * Finishes a member. Removed if nobody marked it while it was being worked on; otherwise made due
 * at ARGV[3] (now), because that mark is about something the work may not have seen.
 */
const DONE = `
local version = redis.call('HGET', KEYS[2], ARGV[1]) or '0'
if version == ARGV[2] then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[2], ARGV[1])
  return 1
end
redis.call('ZADD', KEYS[1], 'XX', ARGV[3], ARGV[1])
return 0`;

/**
 * A set of things that want attention, each with the earliest time it should get it
 * (ADR-0017).
 *
 * A sorted set keyed by member, so a thing marked a thousand times before a consumer gets to it
 * is one entry and one piece of work: coalescing is the data structure. Beside it, a hash counts
 * marks per member, which is how a mark that lands mid-work survives the work finishing.
 *
 * **Consumers claim.** `claim` takes due members and pushes their score out by a lease in one
 * script, so two workers never take the same member at once, and a worker that dies mid-work
 * loses its claim when the lease ends rather than holding the member for ever.
 *
 * It holds hints and nothing else. Nothing here survives a restart — Valkey runs with no
 * persistence, on purpose — and nothing needs to: every consumer re-reads its truth from Postgres,
 * and a periodic pass there catches whatever a lost mark would have woken.
 *
 * Errors propagate; the producer's port swallows them and the consumer logs them.
 */
export class DueSet {
  private readonly versions: string;

  constructor(
    private readonly commands: DueSetCommands,
    private readonly key: string,
  ) {
    this.versions = `${key}:marks`;
  }

  /** Wants attention no earlier than `at`. Keeps a later time already recorded. */
  async mark(member: string, at: Date): Promise<void> {
    await this.commands.eval(MARK, 2, this.key, this.versions, at.getTime(), member);
  }

  /** Takes up to `limit` members due by `now` for `leaseMs`. Nobody else gets them meanwhile. */
  async claim(now: Date, limit: number, leaseMs: number): Promise<readonly DueEntry[]> {
    // Safe: the script returns a flat array and nothing else; each element is checked below.
    const flat = (await this.commands.eval(
      CLAIM,
      2,
      this.key,
      this.versions,
      now.getTime(),
      limit,
      now.getTime() + leaseMs,
    )) as unknown[];
    const entries: DueEntry[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const member = flat[i];
      const score = Number(flat[i + 1]);
      const version = Number(flat[i + 2]);
      if (typeof member === "string" && Number.isFinite(score) && Number.isFinite(version)) {
        entries.push({ member, score, version });
      }
    }
    return entries;
  }

  /** Worked on. Removed, unless it was marked meanwhile, in which case it is due again now. */
  async done(entry: DueEntry, now: Date): Promise<void> {
    await this.commands.eval(
      DONE,
      2,
      this.key,
      this.versions,
      entry.member,
      String(entry.version),
      now.getTime(),
    );
  }

  /** Not now: try again no earlier than `until`. A member already finished is not revived. */
  async defer(entry: DueEntry, until: Date): Promise<void> {
    await this.commands.zadd(this.key, "XX", until.getTime(), entry.member);
  }

  async size(): Promise<number> {
    return await this.commands.zcard(this.key);
  }
}
