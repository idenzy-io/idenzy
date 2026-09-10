import { describe, expect, it } from "vitest";
import {
  bucketOf,
  countByState,
  DEFAULT_LOW_THRESHOLD,
  isAtRisk,
  matchesFilter,
  type RecoverySheet,
  SHEET,
  stateOf,
  tallyBuckets,
} from "../../app/utils/recovery";

function sheet(remaining: number, over: Partial<RecoverySheet> = {}): RecoverySheet {
  return {
    userId: `usr_${remaining}`,
    issuedAt: "2026-08-01T10:00:00.000Z",
    remaining,
    lastUsedAt: null,
    factors: ["totp"],
    ...over,
  };
}

describe("stateOf", () => {
  it("calls a spent sheet none, whatever the threshold", () => {
    expect(stateOf(sheet(0), 3)).toBe("none");
    expect(stateOf(sheet(0), 9)).toBe("none");
  });

  it("takes the threshold as the last low count, not the first healthy one", () => {
    expect(stateOf(sheet(3), 3)).toBe("low");
    expect(stateOf(sheet(4), 3)).toBe("healthy");
    expect(stateOf(sheet(SHEET.codes), DEFAULT_LOW_THRESHOLD)).toBe("healthy");
  });

  it("is at risk only with nothing left, which is what a sheet nobody holds also reads as", () => {
    expect(isAtRisk(sheet(0))).toBe(true);
    expect(isAtRisk(sheet(0, { issuedAt: null }))).toBe(true);
    expect(isAtRisk(sheet(1))).toBe(false);
  });
});

describe("matchesFilter", () => {
  const sheets = [sheet(10), sheet(2), sheet(0)];

  it("keeps everything under all, and one state under each of the others", () => {
    expect(sheets.filter((entry) => matchesFilter(entry, "all", 3))).toHaveLength(3);
    expect(
      sheets.filter((entry) => matchesFilter(entry, "low", 3)).map((s) => s.remaining),
    ).toEqual([2]);
    expect(
      sheets.filter((entry) => matchesFilter(entry, "risk", 3)).map((s) => s.remaining),
    ).toEqual([0]);
  });

  it("moves a sheet between low and healthy as the threshold moves", () => {
    expect(matchesFilter(sheet(5), "low", 3)).toBe(false);
    expect(matchesFilter(sheet(5), "low", 5)).toBe(true);
  });
});

describe("countByState", () => {
  it("counts each state once and everything under all", () => {
    expect(countByState([sheet(10), sheet(3), sheet(1), sheet(0)], 3)).toEqual({
      all: 4,
      risk: 1,
      low: 2,
    });
  });

  it("answers zeroes for a project with no second factor anywhere", () => {
    expect(countByState([], 3)).toEqual({ all: 0, risk: 0, low: 0 });
  });
});

describe("bucketOf", () => {
  it("puts every count a sheet can hold in a bucket", () => {
    expect(bucketOf(10).id).toBe("full");
    expect(bucketOf(9).id).toBe("most");
    expect(bucketOf(7).id).toBe("most");
    expect(bucketOf(6).id).toBe("half");
    expect(bucketOf(4).id).toBe("half");
    expect(bucketOf(3).id).toBe("few");
    expect(bucketOf(1).id).toBe("few");
    expect(bucketOf(0).id).toBe("none");
  });

  it("reads a count the server could not produce as the emptiest, never as untouched", () => {
    expect(bucketOf(-1).id).toBe("none");
    expect(bucketOf(11).id).toBe("none");
  });
});

describe("tallyBuckets", () => {
  it("keeps every bucket, including the empty ones, so the panel does not reshuffle", () => {
    const tally = tallyBuckets([sheet(10), sheet(10), sheet(0)]);
    expect(tally).toHaveLength(5);
    expect(tally.map((bucket) => bucket.count)).toEqual([2, 0, 0, 0, 1]);
    expect(tally[0]?.share).toBe(67);
    expect(tally[4]?.share).toBe(33);
  });

  it("shares nothing out when there is nothing to share", () => {
    expect(tallyBuckets([]).every((bucket) => bucket.count === 0 && bucket.share === 0)).toBe(true);
  });
});
