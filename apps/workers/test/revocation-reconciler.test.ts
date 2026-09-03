import { RevocationSet } from "@idenzy/cache/revocation-set";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import type { RevocationEvent } from "@idenzy/persistence/repository/revocation-event-reader";
import { beforeEach, describe, expect, it } from "vitest";
import {
  effectOf,
  type RevocationEventSource,
  RevocationReconciler,
} from "../src/revocation-reconciler.js";
import { FakeCommands } from "./fakes.js";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const SESSION_UUID = "22222222-2222-2222-2222-222222222222";
const USER_UUID = "33333333-3333-3333-3333-333333333333";
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

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

function reader(
  events: readonly RevocationEvent[],
  onCall?: (since: Date) => void,
): RevocationEventSource {
  return {
    since: (since: Date) => {
      onCall?.(since);
      return Promise.resolve(events.filter((event) => event.createdAt >= since));
    },
  };
}

function revoked(overrides: Partial<RevocationEvent> = {}, at = new Date()): RevocationEvent {
  return {
    projectId: PROJECT,
    topic: "session.revoked",
    payload: {
      userId: USER_UUID,
      sessionIds: [SESSION_UUID],
      scope: "current",
      at: at.toISOString(),
    },
    createdAt: at,
    ...overrides,
  };
}

let commands: FakeCommands;
let clock: MovableClock;
let set: RevocationSet;

beforeEach(() => {
  commands = new FakeCommands();
  clock = new MovableClock();
  set = new RevocationSet(commands, clock, RETENTION);
});

function reconciler(events: readonly RevocationEvent[], onCall?: (since: Date) => void) {
  return new RevocationReconciler(reader(events, onCall), set, clock, new SilentLogger(), {
    retentionSeconds: RETENTION,
  });
}

function subject(issuedAt = clock.nowMs() / 1000) {
  return {
    sessionId: "ses_r0000000000000000000",
    userId: "usr_r0000000000000000000",
    issuedAt: Math.floor(issuedAt),
  };
}

describe("reading an event", () => {
  it("takes a revoked session as a session entry", () => {
    const at = clock.now();

    expect(effectOf(revoked({}, at))).toEqual({
      kind: "sessions",
      sessionIds: [SESSION_UUID],
      at,
    });
  });

  /** The same shape the auth API publishes, so a replay lands on the entry already there. */
  it("takes a sign-out-everywhere as one watermark, not the list it ended", () => {
    const at = clock.now();
    const event = revoked(
      {
        payload: {
          userId: USER_UUID,
          sessionIds: [SESSION_UUID, "44444444-4444-4444-4444-444444444444"],
          scope: "all",
          at: at.toISOString(),
        },
      },
      at,
    );

    expect(effectOf(event)).toEqual({ kind: "user", userId: USER_UUID, at });
  });

  it("takes refresh reuse as the session it revoked", () => {
    const at = clock.now();
    const event = revoked(
      {
        topic: "security.refresh_token_reused",
        payload: { sessionId: SESSION_UUID, familyId: "f", at: at.toISOString() },
      },
      at,
    );

    expect(effectOf(event)).toEqual({ kind: "sessions", sessionIds: [SESSION_UUID], at });
  });

  it("ignores a topic that is not a revocation", () => {
    expect(effectOf(revoked({ topic: "session.created" }))).toBeNull();
  });

  /**
   * These rows outlive the code that wrote them, so a payload whose shape has moved on is
   * something this will meet. Skipping one is right; throwing would stop every event after
   * it from being replayed.
   */
  it("skips a payload it cannot read rather than failing the sweep", () => {
    expect(effectOf(revoked({ payload: { scope: "current" } }))).toBeNull();
    expect(effectOf(revoked({ payload: { scope: "all" } }))).toBeNull();
  });

  it("falls back to when the row was written if the payload has no instant", () => {
    const written = clock.now();

    const effect = effectOf(revoked({ payload: { sessionIds: [SESSION_UUID] } }, written));

    expect(effect).toEqual({ kind: "sessions", sessionIds: [SESSION_UUID], at: written });
  });
});

describe("sweeping", () => {
  /**
   * The reason this exists. Valkey is a cache, so a restart empties every project's set, and
   * because the published snapshot is served from it every customer polling would be told
   * that nothing is revoked. Nothing in the request path would notice, because nothing in
   * the request path reads the set.
   */
  it("puts the window back after the cache has been emptied", async () => {
    const at = clock.now();
    await set.revokeSessions(PROJECT, ["ses_x"], at);
    commands.sorted.clear();
    expect((await set.snapshot(PROJECT)).sessions).toEqual([]);

    await reconciler([revoked({}, at)]).sweep();

    expect((await set.snapshot(PROJECT)).sessions).toHaveLength(1);
  });

  /** Only as far back as the set retains, because anything older is pruned on arrival. */
  it("looks back exactly as far as the set publishes", async () => {
    let asked: Date | undefined;
    await reconciler([], (since) => {
      asked = since;
    }).sweep();

    expect(asked?.getTime()).toBe(clock.nowMs() - RETENTION * 1000);
  });

  /**
   * The property that lets this run on a timer at all. The set is keyed by the instant of
   * the revocation, not the instant of the write, so sweeping the same event again lands on
   * the entry it already wrote and the entry still ages out on schedule.
   */
  it("replays the same event without pushing its expiry forward", async () => {
    const at = clock.now();
    const events = [revoked({}, at)];
    await reconciler(events).sweep();
    clock.advance(120);
    await reconciler(events).sweep();

    clock.advance(RETENTION - 119);

    expect((await set.snapshot(PROJECT)).sessions).toEqual([]);
  });

  /** A timer that threw would take the worker down and leave the thing it backs unbacked. */
  it("survives a reader that fails", async () => {
    const failing: RevocationEventSource = {
      since: () => Promise.reject(new Error("database is down")),
    };
    const worker = new RevocationReconciler(failing, set, clock, new SilentLogger(), {
      retentionSeconds: RETENTION,
    });

    await expect(worker.sweep()).resolves.toBeUndefined();
  });

  it("writes the public ids a token carries, never the row uuids", async () => {
    await reconciler([revoked({}, clock.now())]).sweep();

    const snapshot = await set.snapshot(PROJECT);
    expect(snapshot.sessions[0]?.startsWith("ses_")).toBe(true);
    expect(snapshot.sessions).not.toContain(SESSION_UUID);
  });

  it("leaves a token alone once the replayed window has passed", async () => {
    await reconciler([revoked({}, clock.now())]).sweep();
    clock.advance(RETENTION + 1);

    expect(await set.isRevoked(PROJECT, subject())).toBe(false);
  });
});
