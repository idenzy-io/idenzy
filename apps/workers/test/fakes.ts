import type { RevocationCommands } from "@idenzy/cache/revocation-set";

/** The seven commands, in memory. Cleared to stand in for a Valkey restart. */
export class FakeCommands implements RevocationCommands {
  readonly sorted = new Map<string, Map<string, number>>();
  readonly strings = new Map<string, string>();

  zadd(key: string, ...scoreMembers: (string | number)[]): Promise<unknown> {
    const set = this.sorted.get(key) ?? new Map<string, number>();
    for (let index = 0; index + 1 < scoreMembers.length; index += 2) {
      set.set(String(scoreMembers[index + 1]), Number(scoreMembers[index]));
    }
    this.sorted.set(key, set);
    return Promise.resolve(set.size);
  }

  zscore(key: string, member: string): Promise<string | null> {
    const found = this.sorted.get(key)?.get(member);
    return Promise.resolve(found === undefined ? null : String(found));
  }

  zremrangebyscore(key: string, _min: string, max: string): Promise<unknown> {
    const set = this.sorted.get(key);
    if (set === undefined) return Promise.resolve(0);
    const bound = Number(max.startsWith("(") ? max.slice(1) : max);
    for (const [member, score] of [...set]) {
      if (score < bound) set.delete(member);
    }
    return Promise.resolve(0);
  }

  zrange(key: string, _s: number, _e: number, _w: "WITHSCORES"): Promise<string[]> {
    const set = this.sorted.get(key);
    if (set === undefined) return Promise.resolve([]);
    return Promise.resolve([...set].flatMap(([member, score]) => [member, String(score)]));
  }

  set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  expire(): Promise<unknown> {
    return Promise.resolve(1);
  }
}
