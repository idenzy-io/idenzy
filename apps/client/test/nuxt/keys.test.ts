import { describe, expect, it } from "vitest";
import {
  keysOnTab,
  keyTabOf,
  observationOf,
  observationWords,
  PLACEMENTS,
  type ProjectApiKey,
  PUBLIC_PREFIXES,
  rotationEvidence,
  rotationHeadline,
  rotationInstructions,
  rotationRole,
  rotationsOf,
  tabCounts,
} from "../../app/utils/keys";

const NOW = new Date("2026-09-11T14:00:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function key(part: Partial<ProjectApiKey> & { id: string }): ProjectApiKey {
  return {
    kind: "secret",
    prefix: `sk_${part.id.padEnd(8, "x")}`,
    scopes: [],
    createdAt: ago(100 * DAY),
    lastUsedAt: ago(2 * MINUTE),
    revokedAt: null,
    createdBy: "Ana Rodríguez",
    replaces: null,
    ...part,
  };
}

describe("a rotation", () => {
  it("is never inferred from two live keys of one kind", () => {
    const keys = [
      key({ id: "old" }),
      key({ id: "new", createdAt: ago(2 * DAY), lastUsedAt: null }),
    ];
    expect(rotationsOf(keys)).toEqual([]);
  });

  it("exists only where a live replacement names a live old key", () => {
    const old = key({ id: "old" });
    const replacement = key({ id: "new", createdAt: ago(DAY), lastUsedAt: null, replaces: "old" });
    expect(rotationsOf([old, replacement])).toHaveLength(1);
    expect(rotationsOf([old, { ...replacement, revokedAt: ago(MINUTE) }])).toEqual([]);
    expect(rotationsOf([{ ...old, revokedAt: ago(MINUTE) }, replacement])).toEqual([]);
  });

  it("never calls an undeployed replacement finished", () => {
    const old = key({ id: "old" });
    const replacement = key({
      id: "new",
      createdAt: ago(3 * DAY),
      lastUsedAt: null,
      replaces: "old",
    });
    const [rotation] = rotationsOf([old, replacement]);
    expect(rotation?.step).toBe("evidence");
    expect(rotation && rotationHeadline(rotation)).toBe("Deploy the replacement");
    expect(rotation && rotationEvidence(rotation, NOW).replacement).toMatch(/not finished/);
  });

  it("says the old key is still held when it was presented after the replacement was made", () => {
    const old = key({ id: "old", lastUsedAt: ago(40 * MINUTE) });
    const replacement = key({
      id: "new",
      createdAt: ago(3 * DAY),
      lastUsedAt: ago(5 * MINUTE),
      replaces: "old",
    });
    const [rotation] = rotationsOf([old, replacement]);
    expect(rotation?.step).toBe("revoke");
    expect(rotation?.oldObservedSince).toBe(true);
    expect(rotation && rotationHeadline(rotation)).toBe("Both keys are still in use");
  });

  it("reports silence as no observed use, and never as safe", () => {
    const old = key({ id: "old", lastUsedAt: ago(4 * DAY) });
    const replacement = key({
      id: "new",
      createdAt: ago(3 * DAY),
      lastUsedAt: ago(MINUTE),
      replaces: "old",
    });
    const [rotation] = rotationsOf([old, replacement]);
    const words = rotation
      ? [rotationHeadline(rotation), ...Object.values(rotationEvidence(rotation, NOW))]
      : [];
    expect(words[0]).toMatch(/^No observed use/);
    for (const line of words) expect(line.toLowerCase()).not.toContain("safe");
  });

  it("names each half of the pair", () => {
    const old = key({ id: "old" });
    const replacement = key({ id: "new", replaces: "old" });
    const rotations = rotationsOf([old, replacement]);
    expect(rotationRole(old, rotations)?.role).toBe("old");
    expect(rotationRole(replacement, rotations)?.role).toBe("replacement");
    expect(rotationRole(key({ id: "other" }), rotations)).toBeNull();
  });

  it("ends its instructions by revoking the old key", () => {
    const old = key({ id: "old" });
    const replacement = key({ id: "new", replaces: "old" });
    const [rotation] = rotationsOf([old, replacement]);
    const text = rotation ? rotationInstructions(rotation, "Acme") : "";
    expect(text.split("\n").find((line) => line.startsWith("4."))).toContain(
      `Revoke ${old.prefix}…`,
    );
  });
});

describe("what was observed", () => {
  it("states the window instead of a verdict", () => {
    expect(observationWords(key({ id: "a", lastUsedAt: null }), NOW)).toBe("Not observed");
    expect(observationWords(key({ id: "b", lastUsedAt: ago(3 * MINUTE) }), NOW)).toMatch(
      /^Observed/,
    );
    expect(observationWords(key({ id: "c", lastUsedAt: ago(2 * DAY) }), NOW)).toBe(
      "No observed use in 24 hours",
    );
    expect(observationOf(key({ id: "d", lastUsedAt: ago(DAY - MINUTE) }), NOW)).toBe("recent");
  });
});

describe("where a key goes", () => {
  it("never puts a secret key in browser configuration", () => {
    for (const placement of PLACEMENTS.publishable) {
      expect(PUBLIC_PREFIXES.some((prefix) => placement.name.startsWith(prefix))).toBe(true);
      expect(placement.name).not.toContain("SECRET");
    }
  });

  it("never spells a secret key under a public prefix", () => {
    for (const placement of PLACEMENTS.secret) {
      expect(PUBLIC_PREFIXES.some((prefix) => placement.name.startsWith(prefix))).toBe(false);
    }
  });

  it("keeps a publishable rotation's instructions free of the secret variable", () => {
    const old = key({ id: "old", kind: "publishable", prefix: "pk_oldoldo" });
    const replacement = key({
      id: "new",
      kind: "publishable",
      prefix: "pk_newnewn",
      replaces: "old",
    });
    const [rotation] = rotationsOf([old, replacement]);
    expect(rotation && rotationInstructions(rotation, "Acme")).not.toContain("SECRET");
  });
});

describe("the tabs", () => {
  const keys = [
    key({ id: "pk", kind: "publishable" }),
    key({ id: "sk" }),
    key({ id: "gone", kind: "publishable", revokedAt: ago(DAY) }),
    key({ id: "gone2", revokedAt: ago(2 * DAY) }),
  ];

  const ids = (list: readonly ProjectApiKey[]) => list.map((entry) => entry.id).sort();

  it("lists live keys under All and their kind, and revoked ones under Revoked", () => {
    expect(ids(keysOnTab(keys, "all"))).toEqual(["pk", "sk"]);
    expect(ids(keysOnTab(keys, "publishable"))).toEqual(["pk"]);
    expect(ids(keysOnTab(keys, "revoked"))).toEqual(["gone", "gone2"]);
    expect(tabCounts(keys)).toEqual({ all: 2, publishable: 1, secret: 1, revoked: 2 });
  });

  it("adds revoked keys to All and the kind tabs when asked to show them", () => {
    expect(keysOnTab(keys, "all", true)).toHaveLength(4);
    expect(ids(keysOnTab(keys, "publishable", true))).toEqual(["gone", "pk"]);
    expect(ids(keysOnTab(keys, "revoked", true))).toEqual(["gone", "gone2"]);
    expect(tabCounts(keys, true)).toEqual({ all: 4, publishable: 2, secret: 2, revoked: 2 });
  });

  it("reads anything else in the URL as All keys", () => {
    expect(keyTabOf("secret")).toBe("secret");
    expect(keyTabOf("nonsense")).toBe("all");
    expect(keyTabOf(undefined)).toBe("all");
  });
});
