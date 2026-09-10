import { describe, expect, it } from "vitest";
import {
  hashAddress,
  LOOKUP_ISSUE_LABELS,
  normalizeTarget,
  reasonInfo,
  reasonLabel,
  SUPPRESSION_CHANNEL_LABELS,
  SUPPRESSION_REASONS,
  SUPPRESSION_SOURCES,
  type SuppressionRow,
  shortDigest,
  tallyReasons,
  validateLookup,
} from "../../app/utils/suppressions";

/*
 * The digest is the contract with the server, and the whole screen rests on it: a lookup
 * that hashed differently would answer "not suppressed" for every address on the list, and
 * a release would remove nothing while reporting success. These vectors are what
 * `hashToken` in `@idenzy/crypto` produces for the same input, so the two cannot drift
 * without this failing.
 */
describe("hashAddress", () => {
  it("matches the server's digest for a known address", async () => {
    expect(await hashAddress("alex@example.com")).toBe(
      "6db61e6dcbcf2390e4a46af426f26a133a3bee45021422fc7ae86e9136f14110",
    );
    expect(await hashAddress("bounced@example.com")).toBe(
      "e19335cf67a7ba7ae5769a0f5eaaea3440d85787cb621261d0863c553455d05c",
    );
  });

  it("normalizes first, so one casing covers the other", async () => {
    const expected = await hashAddress("alex@example.com");
    expect(await hashAddress("  ALEX@Example.COM  ")).toBe(expected);
  });

  it("is sixty-four lowercase hex characters, which is what the column holds", async () => {
    expect(await hashAddress("someone@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the empty string rather than throwing, since a caller may pass one", async () => {
    expect(await hashAddress("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("normalizeTarget", () => {
  it("trims and lowercases, matching the writer", () => {
    expect(normalizeTarget("  Alex@Example.com ")).toBe("alex@example.com");
  });
});

describe("validateLookup", () => {
  it("asks for something before it asks about nothing", () => {
    expect(validateLookup("")).toBe("empty");
    expect(validateLookup("   ")).toBe("empty");
  });

  it("catches a typo that would make the answer meaningless", () => {
    expect(validateLookup("alex")).toBe("not_an_address");
    expect(validateLookup("alex@example")).toBe("not_an_address");
    expect(validateLookup("alex example.com")).toBe("not_an_address");
  });

  it("accepts an ordinary address", () => {
    expect(validateLookup("alex@example.com")).toBeNull();
    expect(validateLookup(" alex+tag@mail.example.co.uk ")).toBeNull();
  });

  it("names every issue it can return", () => {
    for (const issue of ["empty", "not_an_address"] as const) {
      expect(LOOKUP_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("shortDigest", () => {
  it("keeps both ends, which is what tells two digests apart", () => {
    const digest = "6db61e6dcbcf2390e4a46af426f26a133a3bee45021422fc7ae86e9136f14110";
    expect(shortDigest(digest)).toBe("6db61e6d…f14110");
  });

  it("leaves a short value alone rather than padding it with an ellipsis", () => {
    expect(shortDigest("abc123")).toBe("abc123");
  });
});

describe("the reasons", () => {
  it("names each once, with a note and a bundled glyph", () => {
    const ids = SUPPRESSION_REASONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SUPPRESSION_REASONS) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
      expect(entry.icon.startsWith("material-symbols:")).toBe(true);
    }
  });

  it("marks the provider-reported reasons as the ones that cost a reputation", () => {
    expect(reasonInfo("hard_bounce")?.severe).toBe(true);
    expect(reasonInfo("complaint")?.severe).toBe(true);
    expect(reasonInfo("invalid_address")?.severe).toBe(true);
    expect(reasonInfo("manual")?.severe).toBe(false);
    expect(reasonInfo("list_unsubscribe")?.severe).toBe(false);
  });

  /* The column is free text, so a value we have never seen has to survive the screen. */
  it("renders an unfamiliar reason as itself rather than hiding it", () => {
    expect(reasonInfo("blocked_by_recipient")).toBeUndefined();
    expect(reasonLabel("blocked_by_recipient")).toBe("blocked_by_recipient");
    expect(reasonLabel("hard_bounce")).toBe("Hard bounce");
  });

  it("names every channel the table can hold", () => {
    for (const channel of ["email", "sms", "whatsapp"] as const) {
      expect(SUPPRESSION_CHANNEL_LABELS[channel].length).toBeGreaterThan(0);
    }
  });
});

describe("tallyReasons", () => {
  const row = (reason: string, id: string): SuppressionRow => ({
    id,
    channel: "email",
    targetHash: id.padEnd(64, "0"),
    reason,
    createdAt: "2026-09-09T12:00:00.000Z",
  });

  it("counts by reason, biggest first", () => {
    const tally = tallyReasons([
      row("hard_bounce", "a"),
      row("complaint", "b"),
      row("hard_bounce", "c"),
    ]);
    expect(tally).toEqual([
      { reason: "hard_bounce", label: "Hard bounce", count: 2, severe: true },
      { reason: "complaint", label: "Marked as spam", count: 1, severe: true },
    ]);
  });

  /* By the label a reader sees rather than the stored value, so the order on screen is
     the one the list is sorted by: "Added by you" before "Marked as spam". */
  it("orders a tie by label, so the list does not reshuffle between reads", () => {
    const tally = tallyReasons([row("complaint", "a"), row("manual", "b")]);
    expect(tally.map((entry) => entry.label)).toEqual(["Added by you", "Marked as spam"]);
  });

  it("carries an unfamiliar reason through with severity off", () => {
    expect(tallyReasons([row("odd_one", "a")])).toEqual([
      { reason: "odd_one", label: "odd_one", count: 1, severe: false },
    ]);
  });

  it("answers an empty list with an empty tally", () => {
    expect(tallyReasons([])).toEqual([]);
  });
});

describe("SUPPRESSION_SOURCES", () => {
  it("says plainly that nothing writes to the list yet", () => {
    expect(SUPPRESSION_SOURCES.length).toBeGreaterThan(0);
    expect(SUPPRESSION_SOURCES.every((source) => !source.built)).toBe(true);
  });

  it("names each once and explains it", () => {
    const ids = SUPPRESSION_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of SUPPRESSION_SOURCES) {
      expect(source.detail.length).toBeGreaterThan(0);
    }
  });
});
