import { describe, expect, it } from "vitest";
import {
  bucketOf,
  CODE_SET,
  countByState,
  DEFAULT_LOW_THRESHOLD,
  factorLabel,
  isAtRisk,
  matchesFilter,
  nextStepFor,
  queueHeading,
  REPLACEMENT_STEPS,
  type RecoverySet,
  remainingLabel,
  replacementText,
  stateOf,
  tallyBuckets,
} from "../../app/utils/recovery";

function codes(remaining: number, over: Partial<RecoverySet> = {}): RecoverySet {
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
  it("calls a spent set none, whatever the threshold", () => {
    expect(stateOf(codes(0), 3)).toBe("none");
    expect(stateOf(codes(0), 9)).toBe("none");
  });

  it("takes the threshold as the last low count, not the first healthy one", () => {
    expect(stateOf(codes(3), 3)).toBe("low");
    expect(stateOf(codes(4), 3)).toBe("healthy");
    expect(stateOf(codes(CODE_SET.codes), DEFAULT_LOW_THRESHOLD)).toBe("healthy");
  });

  it("is at risk only with nothing left, which is what a set nobody holds also reads as", () => {
    expect(isAtRisk(codes(0))).toBe(true);
    expect(isAtRisk(codes(0, { issuedAt: null }))).toBe(true);
    expect(isAtRisk(codes(1))).toBe(false);
  });
});

describe("remainingLabel", () => {
  it("tells a set nobody generated apart from one spent to the last code", () => {
    expect(remainingLabel(codes(0, { issuedAt: null }))).toBe("Never generated");
    expect(remainingLabel(codes(0))).toBe("No codes remaining");
  });

  it("counts the rest against the size of a set", () => {
    expect(remainingLabel(codes(7))).toBe(`7 of ${CODE_SET.codes}`);
    expect(remainingLabel(codes(1))).toBe(`1 of ${CODE_SET.codes}`);
  });

  it("never writes a bare zero, which would claim ten codes that do not exist", () => {
    expect(remainingLabel(codes(0))).not.toContain(`0 of ${CODE_SET.codes}`);
  });
});

describe("factorLabel", () => {
  it("names what the account can still be challenged with, in a stable order", () => {
    expect(factorLabel(codes(4))).toBe("Authenticator");
    expect(factorLabel(codes(4, { factors: ["totp", "passkey"] }))).toBe("Authenticator + passkey");
    expect(factorLabel(codes(4, { factors: ["passkey", "totp"] }))).toBe("Authenticator + passkey");
    expect(factorLabel(codes(4, { factors: ["passkey"] }))).toBe("Passkey");
  });

  it("says None rather than an empty cell for an account holding nothing", () => {
    expect(factorLabel(codes(0, { factors: [] }))).toBe("None");
  });
});

describe("nextStepFor", () => {
  it("names the factor they still hold, because that is what lets them fix it themselves", () => {
    const step = nextStepFor(codes(0, { factors: ["totp", "passkey"] }));
    expect(step).toContain("authenticator + passkey");
    expect(step).toContain("make a new set themselves");
  });

  it("says plainly that nothing here helps once the factor is gone too", () => {
    expect(nextStepFor(codes(0))).toContain("nothing here can let them back in");
  });

  it("does not hurry an account that still has codes", () => {
    expect(nextStepFor(codes(2))).toContain("no hurry");
    expect(nextStepFor(codes(CODE_SET.codes))).toContain("Nothing to do");
  });
});

describe("replacement instructions", () => {
  it("are the owner's steps, and name the call their own screen makes", () => {
    expect(REPLACEMENT_STEPS).toHaveLength(3);
    expect(REPLACEMENT_STEPS[1]).toContain("mfa.regenerateRecoveryCodes()");
    expect(REPLACEMENT_STEPS[2]).toContain("shown once");
  });

  it("copy as numbered plain text, for a ticket", () => {
    const text = replacementText();
    expect(text.split("\n")).toHaveLength(3);
    expect(text.startsWith("1. ")).toBe(true);
    expect(text).not.toContain("<");
  });
});

describe("queueHeading", () => {
  it("leads with the accounts that have nothing left", () => {
    expect(queueHeading({ all: 40, risk: 3, low: 5 })).toBe("3 accounts have no codes left");
    expect(queueHeading({ all: 40, risk: 1, low: 0 })).toBe("1 account has no codes left");
  });

  it("falls back to the ones running low, then to the all-clear", () => {
    expect(queueHeading({ all: 40, risk: 0, low: 2 })).toBe("2 accounts are running low");
    expect(queueHeading({ all: 40, risk: 0, low: 0 })).toBe(
      "Every account has codes to fall back on",
    );
  });

  it("does not claim an all-clear on a project with no second factor anywhere", () => {
    expect(queueHeading({ all: 0, risk: 0, low: 0 })).toBe(
      "No account here holds a second factor yet",
    );
  });
});

describe("matchesFilter", () => {
  const sets = [codes(10), codes(2), codes(0)];

  it("keeps everything under all, and one state under each of the others", () => {
    expect(sets.filter((entry) => matchesFilter(entry, "all", 3))).toHaveLength(3);
    expect(sets.filter((entry) => matchesFilter(entry, "low", 3)).map((s) => s.remaining)).toEqual([
      2,
    ]);
    expect(sets.filter((entry) => matchesFilter(entry, "risk", 3)).map((s) => s.remaining)).toEqual(
      [0],
    );
  });

  it("moves an account between low and healthy as the threshold moves", () => {
    expect(matchesFilter(codes(5), "low", 3)).toBe(false);
    expect(matchesFilter(codes(5), "low", 5)).toBe(true);
  });
});

describe("countByState", () => {
  it("counts each state once and everything under all", () => {
    expect(countByState([codes(10), codes(3), codes(1), codes(0)], 3)).toEqual({
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
  it("puts every count a set can hold in a bucket", () => {
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
  it("keeps every bucket, including the empty ones, so the strip does not reshuffle", () => {
    const tally = tallyBuckets([codes(10), codes(10), codes(0)]);
    expect(tally).toHaveLength(5);
    expect(tally.map((bucket) => bucket.count)).toEqual([2, 0, 0, 0, 1]);
    expect(tally[0]?.share).toBe(67);
    expect(tally[4]?.share).toBe(33);
  });

  it("shares nothing out when there is nothing to share", () => {
    expect(tallyBuckets([]).every((bucket) => bucket.count === 0 && bucket.share === 0)).toBe(true);
  });
});
