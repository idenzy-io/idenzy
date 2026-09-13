import { Clock } from "@idenzy/core/time/clock";
import { describe, expect, it } from "vitest";
import { User, type UserState } from "../src/entities/user.js";
import { ActiveUserMeter } from "../src/ports/active-user-meter.js";

class FixedClock extends Clock {
  constructor(private instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
  moveTo(instant: Date): void {
    this.instant = instant;
  }
}

/** Records what the base decided to pass on, which is the whole surface worth testing. */
class RecordingMeter extends ActiveUserMeter {
  readonly recorded: { projectId: string; userId: string; at: Date }[] = [];

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets a test build one.
  constructor(clock: Clock) {
    super(clock);
  }

  protected override record(projectId: string, userId: string, at: Date): Promise<void> {
    this.recorded.push({ projectId, userId, at });
    return Promise.resolve();
  }
}

const PROJECT = "11111111-1111-1111-1111-111111111111";
const CREATED = new Date("2026-09-03T22:00:00Z");

function user(overrides: Partial<UserState> = {}): User {
  return new User({
    id: "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6e",
    projectId: PROJECT,
    email: "hasan@example.com",
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=1$abc",
    passwordAlgoVersion: 1,
    displayName: null,
    avatarUrl: null,
    metadataPublic: {},
    metadataPrivate: {},
    bannedUntil: null,
    lastSignInAt: null,
    createdAt: CREATED,
    deletedAt: null,
    ...overrides,
  });
}

describe("what counts as a monthly active user", () => {
  it("counts somebody who came back on a later day", async () => {
    const clock = new FixedClock(new Date("2026-09-04T08:00:00Z"));
    const meter = new RecordingMeter(clock);

    await meter.mark(PROJECT, user());

    expect(meter.recorded).toEqual([
      { projectId: PROJECT, userId: user().id, at: new Date("2026-09-04T08:00:00Z") },
    ]);
  });

  it("does not bill an account on the day it was created", async () => {
    const clock = new FixedClock(new Date("2026-09-03T23:59:00Z"));
    const meter = new RecordingMeter(clock);

    await meter.mark(PROJECT, user());

    expect(meter.recorded).toEqual([]);
  });

  it("starts billing at the UTC midnight after sign-up, not 24 hours after it", async () => {
    const clock = new FixedClock(new Date("2026-09-04T00:30:00Z"));
    const meter = new RecordingMeter(clock);

    await meter.mark(PROJECT, user());

    expect(meter.recorded).toHaveLength(1);
  });

  it("leaves an anonymous account out until it is upgraded", async () => {
    const clock = new FixedClock(new Date("2026-09-04T08:00:00Z"));
    const meter = new RecordingMeter(clock);
    const anonymous = user({ email: null, phone: null, passwordHash: null });

    await meter.mark(PROJECT, anonymous);
    expect(meter.recorded).toEqual([]);

    await meter.mark(PROJECT, user());
    expect(meter.recorded).toHaveLength(1);
  });

  it("stamps the day from its own clock, so a session spanning midnight lands in both", async () => {
    const clock = new FixedClock(new Date("2026-09-04T23:59:59Z"));
    const meter = new RecordingMeter(clock);

    await meter.mark(PROJECT, user());
    clock.moveTo(new Date("2026-09-05T00:00:01Z"));
    await meter.mark(PROJECT, user());

    expect(meter.recorded.map((entry) => entry.at.toISOString().slice(0, 10))).toEqual([
      "2026-09-04",
      "2026-09-05",
    ]);
  });
});
