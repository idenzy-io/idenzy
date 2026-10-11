import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import type { OutboxEvent } from "@idenzy/persistence/repository/audit-event-reader";
import type { ErasedUser } from "@idenzy/persistence/repository/erased-user-copies";
import { PERSONAL_EVENT_FIELDS } from "@idenzy/protocol/schemas/webhooks";
import { describe, expect, it } from "vitest";
import {
  analyticsTarget,
  ERASURE_TOPIC,
  type ErasureEvents,
  type ErasureOffsets,
  type ErasureTarget,
  UserErasureRelay,
} from "../src/user-erasure-relay.js";

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

class FixedClock extends Clock {
  constructor(private readonly at: Date) {
    super();
  }
  override now(): Date {
    return this.at;
  }
}

const NOW = new Date("2026-10-11T12:00:00.000Z");
const PROJECT = "22222222-2222-2222-2222-222222222222";

function erasure(seq: number, secondsAgo: number, userId = `user-${String(seq)}`): OutboxEvent {
  return {
    id: `evt-${String(seq)}`,
    projectId: PROJECT,
    topic: ERASURE_TOPIC,
    payload: { userId },
    createdAt: new Date(NOW.getTime() - secondsAgo * 1000),
    seq,
  };
}

class Events implements ErasureEvents {
  constructor(private readonly all: readonly OutboxEvent[]) {}
  outboxSince(_topic: string, sinceSeq: number): Promise<readonly OutboxEvent[]> {
    return Promise.resolve(this.all.filter((event) => event.seq > sinceSeq));
  }
}

class Offsets implements ErasureOffsets {
  readonly positions = new Map<string, number>();
  read(consumer: string): Promise<number | null> {
    return Promise.resolve(this.positions.get(consumer) ?? null);
  }
  advance(consumer: string, position: number): Promise<void> {
    this.positions.set(consumer, position);
    return Promise.resolve();
  }
}

class RecordingTarget implements ErasureTarget {
  readonly erased: ErasedUser[][] = [];
  constructor(
    readonly consumer: string,
    private readonly horizon: Date,
    private readonly fail = false,
  ) {}
  settledBefore(): Promise<Date> {
    return Promise.resolve(this.horizon);
  }
  erase(users: readonly ErasedUser[]): Promise<void> {
    if (this.fail) return Promise.reject(new Error("store is down"));
    this.erased.push([...users]);
    return Promise.resolve();
  }
}

describe("the erasure relay", () => {
  it("erases the settled erasures in one batch and moves past exactly those", async () => {
    const offsets = new Offsets();
    const target = new RecordingTarget("t", new Date(NOW.getTime() - 60_000));
    const relay = new UserErasureRelay(
      new Events([erasure(1, 300), erasure(2, 120), erasure(3, 10), erasure(4, 400)]),
      offsets,
      [target],
      new SilentLogger(),
    );

    expect(await relay.sweep()).toBe(2);
    expect(target.erased).toEqual([
      [
        { projectId: PROJECT, userId: "user-1" },
        { projectId: PROJECT, userId: "user-2" },
      ],
    ]);
    // Stopped at the first one still settling, even though a later one is older: the position
    // can only move past a prefix, or the one skipped would never be erased.
    expect(offsets.positions.get("t")).toBe(2);
  });

  it("holds one target back without holding back the others", async () => {
    const offsets = new Offsets();
    const settled = new Date(NOW.getTime() - 60_000);
    const down = new RecordingTarget("analytics", settled, true);
    const up = new RecordingTarget("messages", settled);
    const relay = new UserErasureRelay(
      new Events([erasure(1, 300)]),
      offsets,
      [down, up],
      new SilentLogger(),
    );

    expect(await relay.sweep()).toBe(1);
    expect(offsets.positions.has("analytics")).toBe(false);
    expect(offsets.positions.get("messages")).toBe(1);
  });

  it("passes over an event that names nobody, and still moves past it", async () => {
    const offsets = new Offsets();
    const target = new RecordingTarget("t", NOW);
    const relay = new UserErasureRelay(
      new Events([erasure(1, 300, "")]),
      offsets,
      [target],
      new SilentLogger(),
    );
    await relay.sweep();
    expect(target.erased).toEqual([[]]);
    expect(offsets.positions.get("t")).toBe(1);
  });
});

describe("when the analytics store has settled", () => {
  it("waits for the oldest event still queued for ingestion, less a margin", async () => {
    const queued = new Date(NOW.getTime() - 30_000);
    const target = analyticsTarget(
      () => Promise.resolve(queued),
      () => Promise.resolve(),
      new FixedClock(NOW),
    );
    expect((await target.settledBefore()).getTime()).toBe(queued.getTime() - 60_000);
  });

  it("follows the clock when nothing is queued", async () => {
    const target = analyticsTarget(
      () => Promise.resolve(null),
      () => Promise.resolve(),
      new FixedClock(NOW),
    );
    expect((await target.settledBefore()).getTime()).toBe(NOW.getTime() - 60_000);
  });
});

describe("what an erasure strips from messages", () => {
  /**
   * Every field a webhook carries that names or locates somebody. A new one that is personal
   * and not flagged `personal` would outlive every erasure in the copies still waiting to send.
   */
  it("is the address, the number and where they signed in from", () => {
    expect([...PERSONAL_EVENT_FIELDS].sort()).toEqual(["email", "ip", "phone", "userAgent"]);
  });
});
