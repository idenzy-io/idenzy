import { describe, expect, it } from "vitest";
import {
  DELIVERY_CAPABILITIES,
  deliveryStatus,
  hashAddress,
  ingestionAvailable,
  JUSTIFICATION_MIN,
  LOOKUP_ISSUE_LABELS,
  type LookupAnswer,
  nextStepFor,
  normalizeTarget,
  reasonInfo,
  reasonLabel,
  releaseDecision,
  SUPPRESSION_CHANNEL_LABELS,
  SUPPRESSION_REASONS,
  type SuppressionRow,
  shortDigest,
  sourceLabel,
  tallyReasons,
  validateJustification,
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

describe("the capability list", () => {
  it("says the recorder is live, and still names what is missing beside it", () => {
    expect(ingestionAvailable()).toBe(true);
    // Provider events land now; per-message history and the outbound webhook do not. The
    // list exists so those stay separately true rather than collapsing into one claim.
    expect(DELIVERY_CAPABILITIES.some((entry) => entry.state === "not_built")).toBe(true);
  });

  it("names each once and says what is true of it", () => {
    const ids = DELIVERY_CAPABILITIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of DELIVERY_CAPABILITIES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.finding.length).toBeGreaterThan(0);
    }
  });

  /* The page leads with this badge, and it keys on the recorder rather than on every row
     being live: a green badge over a list nothing writes to reads as "nothing has ever
     bounced", which is the one thing it must never be able to say. */
  it("warns only while nothing records, whatever else is missing", () => {
    const recorder = {
      id: "provider_events",
      label: "Recording a bounce or a complaint",
      finding: "x",
    };

    expect(deliveryStatus([{ ...recorder, state: "not_built" }]).tone).toBe("warning");
    expect(deliveryStatus([{ ...recorder, state: "live" }]).tone).toBe("success");

    // The real list: recording, with gaps named. Green, and not the unqualified word.
    expect(deliveryStatus().tone).toBe("success");
    expect(deliveryStatus().label).toBe("Recording");
    expect(
      deliveryStatus([
        { ...recorder, state: "live" },
        { id: "release", label: "Allowing email again", state: "live", finding: "x" },
      ]).label,
    ).toBe("Fully recorded");
  });
});

describe("sourceLabel", () => {
  it("separates what a provider reported from what somebody here chose", () => {
    expect(sourceLabel("hard_bounce")).toMatch(/provider/i);
    expect(sourceLabel("manual")).toMatch(/dashboard/i);
  });
});

/*
 * The release is conditional, and these are the two conditions. A channel this screen does
 * not own must not be released from it, or the acceptance check that an email release
 * leaves SMS blocked cannot hold; and a block a provider reported asks for the evidence,
 * because releasing it overrules a mailbox rather than undoing a mistake.
 */
describe("releaseDecision", () => {
  const row = (reason: string, channel: SuppressionRow["channel"]): SuppressionRow => ({
    id: "sup_1",
    channel,
    targetHash: "a".repeat(64),
    reason,
    createdAt: "2026-09-09T12:00:00.000Z",
  });

  it("refuses a channel this screen does not own", () => {
    const decision = releaseDecision(row("hard_bounce", "sms"));
    expect(decision.rule).toBe("elsewhere");
    expect(decision.allowed).toBe(false);
  });

  it("asks for a reason where a provider reported the block", () => {
    for (const reason of ["hard_bounce", "complaint", "invalid_address", "list_unsubscribe"]) {
      expect(releaseDecision(row(reason, "email")).rule).toBe("justified");
    }
  });

  it("asks for nothing where the block was added from the dashboard", () => {
    expect(releaseDecision(row("manual", "email")).rule).toBe("direct");
  });

  /* An unfamiliar reason is treated as reported, because the one thing we know is that
     nobody on this project typed it. */
  it("treats a reason it does not know as reported", () => {
    expect(releaseDecision(row("blocked_by_recipient", "email")).rule).toBe("justified");
  });
});

describe("validateJustification", () => {
  it("refuses nothing and refuses a word", () => {
    expect(validateJustification("")).toBe("empty");
    expect(validateJustification("   ")).toBe("empty");
    expect(validateJustification("fixed")).toBe("too_short");
  });

  it("accepts a sentence somebody else could read later", () => {
    expect(validateJustification("Owner confirmed the mailbox works")).toBeNull();
    expect(validateJustification("x".repeat(JUSTIFICATION_MIN))).toBeNull();
  });
});

/*
 * The finding this screen was rebuilt for: "not found" is not proof of deliverability, and
 * the words have to change with the pipeline behind them.
 */
describe("nextStepFor", () => {
  const answer = (over: Partial<LookupAnswer> = {}): LookupAnswer => ({
    asked: "alex@example.com",
    digest: "a".repeat(64),
    checkedAt: "2026-09-11T12:00:00.000Z",
    verdict: "clear",
    email: null,
    others: [],
    failure: null,
    ...over,
  });

  const blocked = (reason: string): LookupAnswer =>
    answer({
      verdict: "blocked",
      email: {
        id: "sup_1",
        channel: "email",
        targetHash: "a".repeat(64),
        reason,
        createdAt: "2026-09-09T12:00:00.000Z",
      },
    });

  it("calls an unrecorded absence unknown rather than deliverable", () => {
    const step = nextStepFor(answer(), false);
    expect(step.detail).toMatch(/nothing writes to the list/i);
    expect(step.steps.some((line) => /unknown/i.test(line))).toBe(true);
  });

  it("still refuses to promise delivery where the recorder works", () => {
    const step = nextStepFor(answer(), true);
    expect(step.detail).toMatch(/not the same as one arriving/i);
    expect(step.steps.some((line) => /provider console/i.test(line))).toBe(true);
  });

  /* One "release it" under every block would be the wrong advice five times out of six,
     which is the reason this is keyed by reason rather than by verdict. */
  it("gives each reason its own repair", () => {
    const titles = [
      "hard_bounce",
      "complaint",
      "invalid_address",
      "list_unsubscribe",
      "manual",
    ].map((reason) => nextStepFor(blocked(reason), false).title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(nextStepFor(blocked("hard_bounce"), false).detail).toMatch(/corrected address/i);
    expect(nextStepFor(blocked("complaint"), false).detail).toMatch(/spam button/i);
  });

  it("answers an unfamiliar reason without inventing a repair for it", () => {
    const step = nextStepFor(blocked("blocked_by_recipient"), false);
    expect(step.steps.some((line) => /evidence/i.test(line))).toBe(true);
  });

  it("says nothing was compared where nothing was", () => {
    const step = nextStepFor(answer({ verdict: "unavailable", failure: "no_crypto" }), true);
    expect(step.title).toMatch(/hash/i);
    expect(step.steps.some((line) => /unread list is not an empty one/i.test(line))).toBe(true);
  });

  it("always gives at least one thing to do", () => {
    for (const one of [answer(), blocked("manual"), answer({ verdict: "unavailable" })]) {
      expect(nextStepFor(one, true).steps.length).toBeGreaterThan(0);
    }
  });
});
