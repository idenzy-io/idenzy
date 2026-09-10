import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_CHOICES,
  ACCESS_TOKEN_CEILING_SECONDS,
  ACCESS_TOKEN_CHOICES,
  ACCESS_TOKEN_FLOOR_SECONDS,
  choiceRange,
  DEFAULT_LIFETIME_SETTINGS,
  durationChoices,
  FIXED_CLOCKS,
  heldOpenEnd,
  IDLE_CHOICES,
  isAbsoluteOffered,
  isIdleOffered,
  type LifetimeSettings,
  LONGEST_CLOCK_SECONDS,
  REFRESH_TOKEN_SECONDS,
  REVOCATION_POLL_SECONDS,
  REVOCATION_SKEW_SECONDS,
  rangeWords,
  refreshesPerActiveUser,
  revocationWindowSeconds,
  SHORTEST_CLOCK_SECONDS,
  shortDuration,
  snapshotRetentionSeconds,
  untouchedEnd,
} from "../../app/utils/lifetimes";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("the choices offered", () => {
  it("keeps every access-token choice inside the server's own bounds", () => {
    for (const seconds of ACCESS_TOKEN_CHOICES) {
      expect(seconds).toBeGreaterThanOrEqual(ACCESS_TOKEN_FLOOR_SECONDS);
      expect(seconds).toBeLessThanOrEqual(ACCESS_TOKEN_CEILING_SECONDS);
    }
    expect(ACCESS_TOKEN_CHOICES).toContain(DEFAULT_LIFETIME_SETTINGS.accessTokenSeconds);
  });

  it("offers the defaults as a pair the other control would allow", () => {
    const { idleSeconds, absoluteSeconds } = DEFAULT_LIFETIME_SETTINGS;
    expect(IDLE_CHOICES).toContain(idleSeconds);
    expect(ABSOLUTE_CHOICES).toContain(absoluteSeconds);
    expect(isIdleOffered(idleSeconds, absoluteSeconds)).toBe(true);
    expect(isAbsoluteOffered(absoluteSeconds, idleSeconds)).toBe(true);
  });

  it("refuses the pair where the idle window could never fire, and allows equality", () => {
    expect(isIdleOffered(90 * DAY, 30 * DAY)).toBe(false);
    expect(isAbsoluteOffered(30 * DAY, 90 * DAY)).toBe(false);
    expect(isIdleOffered(30 * DAY, 30 * DAY)).toBe(true);
    expect(isAbsoluteOffered(30 * DAY, 30 * DAY)).toBe(true);
  });
});

describe("durationChoices", () => {
  it("writes a whole set in one unit, so segments are read against each other", () => {
    expect(durationChoices(ACCESS_TOKEN_CHOICES).map((choice) => choice.label)).toEqual([
      "1 min",
      "5 min",
      "15 min",
      "30 min",
      "60 min",
    ]);
    expect(durationChoices(IDLE_CHOICES).map((choice) => choice.label)).toEqual([
      "1 d",
      "7 d",
      "14 d",
      "30 d",
      "90 d",
    ]);
  });

  it("steps down to the unit that writes every member whole", () => {
    expect(durationChoices([30, 90]).map((choice) => choice.label)).toEqual(["30 s", "90 s"]);
    expect(durationChoices([HOUR, 90 * MINUTE]).map((choice) => choice.label)).toEqual([
      "60 min",
      "90 min",
    ]);
  });

  it("carries the seconds through as the control's value", () => {
    expect(durationChoices([300]).map((choice) => choice.value)).toEqual(["300"]);
  });
});

describe("rangeWords", () => {
  it("writes both ends in one unit, so neither is arithmetic", () => {
    expect(rangeWords(MINUTE, HOUR)).toBe("1 min to 60 min");
    expect(rangeWords(DAY, 90 * DAY)).toBe("1 d to 90 d");
    expect(rangeWords(30 * DAY, 365 * DAY)).toBe("30 d to 365 d");
  });
});

describe("shortDuration", () => {
  it("writes one duration in the largest unit that leaves it whole", () => {
    expect(shortDuration(45)).toBe("45 s");
    expect(shortDuration(5 * MINUTE)).toBe("5 min");
    expect(shortDuration(90 * MINUTE)).toBe("90 min");
    expect(shortDuration(2 * HOUR)).toBe("2 h");
    expect(shortDuration(14 * DAY)).toBe("14 d");
  });
});

describe("choiceRange", () => {
  it("takes the ends of the choices a control offers, so a rail cannot overstate them", () => {
    expect(choiceRange(ACCESS_TOKEN_CHOICES)).toEqual({
      minSeconds: ACCESS_TOKEN_FLOOR_SECONDS,
      maxSeconds: ACCESS_TOKEN_CEILING_SECONDS,
    });
    expect(choiceRange(IDLE_CHOICES)).toEqual({ minSeconds: DAY, maxSeconds: 90 * DAY });
    expect(choiceRange(ABSOLUTE_CHOICES)).toEqual({ minSeconds: 30 * DAY, maxSeconds: 365 * DAY });
  });

  it("does not care what order the choices are written in", () => {
    expect(choiceRange([HOUR, MINUTE, 5 * MINUTE])).toEqual({
      minSeconds: MINUTE,
      maxSeconds: HOUR,
    });
  });

  it("keeps every range inside the span the screen covers, and the right way round", () => {
    for (const choices of [ACCESS_TOKEN_CHOICES, IDLE_CHOICES, ABSOLUTE_CHOICES]) {
      const { minSeconds, maxSeconds } = choiceRange(choices);
      expect(minSeconds).toBeGreaterThanOrEqual(SHORTEST_CLOCK_SECONDS);
      expect(maxSeconds).toBeLessThanOrEqual(LONGEST_CLOCK_SECONDS);
      expect(minSeconds).toBeLessThan(maxSeconds);
    }
  });
});

describe("what a lifetime costs", () => {
  it("prices the default at roughly the 150 refreshes PROJECT.md assumes", () => {
    expect(refreshesPerActiveUser(5 * MINUTE)).toBe(144);
    expect(refreshesPerActiveUser(MINUTE)).toBe(720);
    expect(refreshesPerActiveUser(HOUR)).toBe(12);
  });

  it("waits out the whole lifetime without a set and one poll with one", () => {
    expect(revocationWindowSeconds(5 * MINUTE, false)).toBe(5 * MINUTE);
    expect(revocationWindowSeconds(5 * MINUTE, true)).toBe(REVOCATION_POLL_SECONDS);
    expect(revocationWindowSeconds(HOUR, true)).toBe(REVOCATION_POLL_SECONDS);
  });

  it("keeps a snapshot one lifetime plus the skew, which is what bounds it", () => {
    expect(snapshotRetentionSeconds(5 * MINUTE)).toBe(5 * MINUTE + REVOCATION_SKEW_SECONDS);
  });
});

describe("what ends a session", () => {
  const settings = (change: Partial<LifetimeSettings>): LifetimeSettings => ({
    ...DEFAULT_LIFETIME_SETTINGS,
    ...change,
  });

  it("names the idle window when it is the first to fall", () => {
    expect(untouchedEnd(settings({ idleSeconds: 7 * DAY }))).toEqual({
      clock: "idle",
      seconds: 7 * DAY,
    });
  });

  it("names the refresh token when an idle window outlives it", () => {
    const end = untouchedEnd(settings({ idleSeconds: 90 * DAY, absoluteSeconds: 180 * DAY }));
    expect(end).toEqual({ clock: "refresh", seconds: REFRESH_TOKEN_SECONDS });
  });

  it("names the maximum lifetime when it is shorter than both", () => {
    const end = untouchedEnd(settings({ idleSeconds: 30 * DAY, absoluteSeconds: 30 * DAY }));
    expect(end.clock).toBe("idle");
    expect(untouchedEnd(settings({ idleSeconds: 90 * DAY, absoluteSeconds: 30 * DAY }))).toEqual({
      clock: "absolute",
      seconds: 30 * DAY,
    });
  });

  it("gives a session in daily use the maximum lifetime and nothing else", () => {
    for (const absoluteSeconds of ABSOLUTE_CHOICES) {
      expect(heldOpenEnd(settings({ absoluteSeconds }))).toEqual({
        clock: "absolute",
        seconds: absoluteSeconds,
      });
    }
  });
});

describe("FIXED_CLOCKS", () => {
  it("states no lifetime the config schema would refuse", () => {
    for (const clock of FIXED_CLOCKS) {
      if (clock.capSeconds === null) continue;
      expect(clock.seconds).toBeLessThanOrEqual(clock.capSeconds);
    }
  });

  it("names each clock once and says why each is the length it is", () => {
    expect(new Set(FIXED_CLOCKS.map((clock) => clock.id)).size).toBe(FIXED_CLOCKS.length);
    for (const clock of FIXED_CLOCKS) {
      expect(clock.note.length).toBeGreaterThan(0);
      expect(clock.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps every clock inside the span the screen covers", () => {
    for (const clock of FIXED_CLOCKS) {
      expect(clock.seconds).toBeGreaterThanOrEqual(SHORTEST_CLOCK_SECONDS);
      expect(clock.seconds).toBeLessThanOrEqual(LONGEST_CLOCK_SECONDS);
    }
  });
});
