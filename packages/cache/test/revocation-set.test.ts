import { Clock } from "@idenzy/core/time/clock";
import { beforeEach, describe, expect, it } from "vitest";
import { type RevocationCommands, RevocationSet } from "../src/revocation-set.js";

const PROJECT = "prj_00000000000000000001";
const SESSION = "ses_00000000000000000001";
const OTHER_SESSION = "ses_00000000000000000002";
const USER = "usr_00000000000000000001";
const RETENTION = 360;

class MovableClock extends Clock {
  private at = new Date("2026-09-03T12:00:00.000Z");

  override now(): Date {
    return this.at;
  }

  advance(seconds: number): void {
    this.at = new Date(this.at.getTime() + seconds * 1000);
  }
}

/**
 * The seven commands, in memory.
 *
 * Enough of Valkey's semantics to be worth asserting against: scores order the set, the
 * exclusive `(n` bound on a range removal means what it means, and `WITHSCORES` comes
 * back as the flat list the real client returns.
 */
class FakeCommands implements RevocationCommands {
  readonly sorted = new Map<string, Map<string, number>>();
  readonly strings = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  readonly calls: string[] = [];

  zadd(key: string, ...scoreMembers: (string | number)[]): Promise<unknown> {
    this.calls.push("zadd");
    const set = this.sorted.get(key) ?? new Map<string, number>();
    for (let index = 0; index + 1 < scoreMembers.length; index += 2) {
      set.set(String(scoreMembers[index + 1]), Number(scoreMembers[index]));
    }
    this.sorted.set(key, set);
    return Promise.resolve(set.size);
  }

  zscore(key: string, member: string): Promise<string | null> {
    this.calls.push("zscore");
    const found = this.sorted.get(key)?.get(member);
    return Promise.resolve(found === undefined ? null : String(found));
  }

  zremrangebyscore(key: string, min: string, max: string): Promise<unknown> {
    this.calls.push("zremrangebyscore");
    const set = this.sorted.get(key);
    if (set === undefined) return Promise.resolve(0);
    const exclusive = max.startsWith("(");
    const bound = Number(exclusive ? max.slice(1) : max);
    const floor = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    let removed = 0;
    for (const [member, score] of [...set]) {
      const above = score >= floor;
      const below = exclusive ? score < bound : score <= bound;
      if (above && below) {
        set.delete(member);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  zrange(key: string, _start: number, _stop: number, _withScores: "WITHSCORES"): Promise<string[]> {
    this.calls.push("zrange");
    const set = this.sorted.get(key);
    if (set === undefined) return Promise.resolve([]);
    const flat = [...set]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .flatMap(([member, score]) => [member, String(score)]);
    return Promise.resolve(flat);
  }

  set(key: string, value: string, _mode: "EX", seconds: number): Promise<unknown> {
    this.calls.push("set");
    this.strings.set(key, value);
    this.expiries.set(key, seconds);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    this.calls.push("get");
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  expire(key: string, seconds: number): Promise<unknown> {
    this.calls.push("expire");
    this.expiries.set(key, seconds);
    return Promise.resolve(1);
  }
}

let commands: FakeCommands;
let clock: MovableClock;
let set: RevocationSet;

beforeEach(() => {
  commands = new FakeCommands();
  clock = new MovableClock();
  set = new RevocationSet(commands, clock, RETENTION);
});

function subject(overrides: Partial<{ sessionId: string; userId: string; issuedAt: number }> = {}) {
  return {
    sessionId: SESSION,
    userId: USER,
    issuedAt: Math.floor(clock.nowMs() / 1000),
    ...overrides,
  };
}

describe("revoking a session", () => {
  it("answers revoked, and only for that session", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());

    expect(await set.isRevoked(PROJECT, subject())).toBe(true);
    expect(await set.isRevoked(PROJECT, subject({ sessionId: OTHER_SESSION }))).toBe(false);
  });

  it("kills every token for it, however recently one was minted", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());
    clock.advance(30);

    // A refresh mints a new access token for the same session, so `iat` moves and `sid`
    // does not. A session revocation has to outlive that or it revokes nothing.
    expect(await set.isRevoked(PROJECT, subject())).toBe(true);
  });

  it("writes several in one round trip rather than one each", async () => {
    await set.revokeSessions(PROJECT, [SESSION, OTHER_SESSION], clock.now());

    expect(commands.calls.filter((call) => call === "zadd")).toHaveLength(1);
  });

  it("does nothing at all for an empty list", async () => {
    await set.revokeSessions(PROJECT, [], clock.now());

    expect(commands.calls).toHaveLength(0);
  });
});

describe("a user watermark", () => {
  /** One entry rather than one per session, which is what makes a bulk revoke bounded. */
  it("kills a token issued before it", async () => {
    clock.advance(10);
    const issued = Math.floor(clock.nowMs() / 1000);
    clock.advance(10);

    await set.revokeUser(PROJECT, USER, clock.now());

    expect(await set.isRevoked(PROJECT, subject({ issuedAt: issued }))).toBe(true);
  });

  /**
   * The conservative half of the rule, and the one worth a test. `iat` is only accurate
   * to the second, so a token minted after the revocation but inside the same second is
   * indistinguishable from one minted before it. Sparing it under-revokes by less than a
   * second; killing it would revoke a token issued after the event, which is the failure
   * ADR-0009 refuses because nothing the client does can clear it.
   */
  it("spares a token issued in its own second", async () => {
    await set.revokeUser(PROJECT, USER, clock.now());

    expect(await set.isRevoked(PROJECT, subject())).toBe(false);
  });

  it("spares a token issued after it", async () => {
    await set.revokeUser(PROJECT, USER, clock.now());
    clock.advance(5);

    expect(await set.isRevoked(PROJECT, subject())).toBe(false);
  });

  it("leaves another user alone", async () => {
    clock.advance(10);
    const issued = Math.floor(clock.nowMs() / 1000);
    clock.advance(10);

    await set.revokeUser(PROJECT, USER, clock.now());

    expect(
      await set.isRevoked(
        PROJECT,
        subject({ userId: "usr_00000000000000000002", issuedAt: issued }),
      ),
    ).toBe(false);
  });
});

describe("a project watermark", () => {
  it("kills every token issued before it", async () => {
    clock.advance(10);
    const issued = Math.floor(clock.nowMs() / 1000);
    clock.advance(10);

    await set.revokeProject(PROJECT, clock.now());

    expect(
      await set.isRevoked(
        PROJECT,
        subject({ sessionId: OTHER_SESSION, userId: "usr_x", issuedAt: issued }),
      ),
    ).toBe(true);
  });

  it("does not reach another project", async () => {
    clock.advance(10);
    const issued = Math.floor(clock.nowMs() / 1000);
    clock.advance(10);

    await set.revokeProject(PROJECT, clock.now());

    expect(await set.isRevoked("prj_00000000000000000002", subject({ issuedAt: issued }))).toBe(
      false,
    );
  });
});

describe("retention", () => {
  it("stops answering revoked once nothing it covers can still be live", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());
    clock.advance(RETENTION + 1);

    expect(await set.isRevoked(PROJECT, subject())).toBe(false);
  });

  /**
   * The set has to shrink on its own. Pruning only when the snapshot is served would let
   * a deployment with no SDK polling it grow one entry per revocation for the life of the
   * project, which is the one way a bounded set stops being bounded.
   */
  it("prunes on write, not only when something asks for the snapshot", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());
    clock.advance(RETENTION + 1);

    await set.revokeSessions(PROJECT, [OTHER_SESSION], clock.now());

    expect([...(commands.sorted.get(`rev:s:${PROJECT}`) ?? [])].map(([id]) => id)).toEqual([
      OTHER_SESSION,
    ]);
  });

  /**
   * What makes the reconciler free to replay. It re-applies the same outbox event on every
   * pass, and an entry whose score moved forward each time would never age out: the set
   * would stop being bounded by retention and start being bounded by nothing.
   */
  it("lands a replayed revocation on the same entry rather than a fresher one", async () => {
    const revokedAt = clock.now();
    await set.revokeSessions(PROJECT, [SESSION], revokedAt);
    clock.advance(120);

    await set.revokeSessions(PROJECT, [SESSION], revokedAt);
    clock.advance(RETENTION - 119);

    expect(await set.isRevoked(PROJECT, subject())).toBe(false);
  });

  /** So a project that stops revoking stops holding a set at all. */
  it("gives the key an expiry every time it writes", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());

    expect(commands.expiries.get(`rev:s:${PROJECT}`)).toBe(RETENTION);
  });
});

describe("the published snapshot", () => {
  it("carries all three shapes", async () => {
    clock.advance(10);
    await set.revokeSessions(PROJECT, [SESSION], clock.now());
    await set.revokeUser(PROJECT, USER, clock.now());
    await set.revokeProject(PROJECT, clock.now());
    const at = Math.floor(clock.nowMs() / 1000);

    const snapshot = await set.snapshot(PROJECT);

    expect(snapshot.sessions).toEqual([SESSION]);
    expect(snapshot.users).toEqual([{ userId: USER, revokedBefore: at }]);
    expect(snapshot.projectRevokedBefore).toBe(at);
  });

  it("drops what has aged out, so the payload cannot grow with tenure", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());
    await set.revokeUser(PROJECT, USER, clock.now());
    clock.advance(RETENTION + 1);
    await set.revokeSessions(PROJECT, [OTHER_SESSION], clock.now());

    const snapshot = await set.snapshot(PROJECT);

    expect(snapshot.sessions).toEqual([OTHER_SESSION]);
    expect(snapshot.users).toEqual([]);
    expect(snapshot.projectRevokedBefore).toBeNull();
  });

  it("is empty for a project that has revoked nothing", async () => {
    const snapshot = await set.snapshot(PROJECT);

    expect(snapshot).toEqual({ sessions: [], users: [], projectRevokedBefore: null });
  });
});
