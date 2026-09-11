import { describe, expect, it } from "vitest";
import {
  assembledClaims,
  CLAIMABLE_USER_FIELDS,
  type ClaimMapping,
  claimPathText,
  defaultClaimName,
  isSameTemplate,
  isTemplateValid,
  MAX_CLAIM_BYTES,
  MAX_CLAIMS,
  namesBytes,
  profileOutcomes,
  RESERVED_CLAIMS,
  refusedProfiles,
  renderTemplate,
  SAMPLE_PROFILES,
  type SampleProfile,
  templateChanges,
  tokenLines,
  validateMapping,
  validateTemplate,
} from "../../app/utils/claims";

/* Three profiles the file promises; a missing one fails the first assertion below. */
const complete = (SAMPLE_PROFILES[0] as SampleProfile).user;
const sparse = (SAMPLE_PROFILES[1] as SampleProfile).user;
const phoneOnly = (SAMPLE_PROFILES[2] as SampleProfile).user;

const mapping = (over: Partial<ClaimMapping>): ClaimMapping => ({
  name: "email",
  source: "user",
  path: "email",
  required: false,
  ...over,
});

describe("validateMapping", () => {
  it("accepts a plain mapping and a namespaced name", () => {
    expect(validateMapping([mapping({})], 0)).toEqual([]);
    expect(validateMapping([mapping({ name: "https://acme.com/plan" })], 0)).toEqual([]);
  });

  it("refuses every reserved name, and nothing that merely contains one", () => {
    for (const reserved of RESERVED_CLAIMS) {
      expect(validateMapping([mapping({ name: reserved })], 0)).toContain("name_reserved");
    }
    expect(validateMapping([mapping({ name: "subject" })], 0)).toEqual([]);
  });

  it("refuses an empty, an overlong and a badly spelt name", () => {
    expect(validateMapping([mapping({ name: "  " })], 0)).toEqual(["name_empty"]);
    expect(validateMapping([mapping({ name: "a".repeat(65) })], 0)).toContain("name_long");
    expect(validateMapping([mapping({ name: "has space" })], 0)).toContain("name_chars");
  });

  it("refuses two mappings onto one name, on the second and the first alike", () => {
    const claims = [mapping({ name: "plan" }), mapping({ name: " plan " })];
    expect(validateMapping(claims, 0)).toContain("name_duplicate");
    expect(validateMapping(claims, 1)).toContain("name_duplicate");
  });

  it("holds the user source to the allowlist and lets metadata name any key", () => {
    expect(validateMapping([mapping({ path: "passwordHash" })], 0)).toEqual(["path_unknown_field"]);
    for (const field of CLAIMABLE_USER_FIELDS) {
      expect(validateMapping([mapping({ path: field })], 0)).toEqual([]);
    }
    expect(validateMapping([mapping({ source: "metadata_public", path: "anything" })], 0)).toEqual(
      [],
    );
    expect(validateMapping([mapping({ source: "metadata_public", path: "" })], 0)).toEqual([
      "path_empty",
    ]);
  });
});

describe("validateTemplate", () => {
  it("caps the count and the bytes of the names alone", () => {
    const many = Array.from({ length: MAX_CLAIMS + 1 }, (_, i) => mapping({ name: `c${i}` }));
    expect(validateTemplate({ claims: many, acknowledgePrivateMetadata: false })).toContain(
      "too_many",
    );
    const long = Array.from({ length: MAX_CLAIMS }, (_, i) =>
      mapping({ name: `${"x".repeat(60)}${i.toString().padStart(3, "0")}` }),
    );
    expect(namesBytes(long)).toBeGreaterThan(MAX_CLAIM_BYTES);
    expect(validateTemplate({ claims: long, acknowledgePrivateMetadata: false })).toContain(
      "names_too_large",
    );
  });

  it("measures the names the way the server does", () => {
    expect(namesBytes([mapping({ name: "plan" })])).toBe(JSON.stringify({ plan: "" }).length);
    expect(namesBytes([])).toBe(2);
  });

  it("wants the acknowledgement only while private metadata is read", () => {
    const priv = [mapping({ name: "org", source: "metadata_private", path: "orgId" })];
    expect(validateTemplate({ claims: priv, acknowledgePrivateMetadata: false })).toEqual([
      "private_unacknowledged",
    ]);
    expect(validateTemplate({ claims: priv, acknowledgePrivateMetadata: true })).toEqual([]);
    expect(validateTemplate({ claims: [mapping({})], acknowledgePrivateMetadata: false })).toEqual(
      [],
    );
  });

  it("calls the whole valid only when every part is", () => {
    expect(isTemplateValid({ claims: [mapping({})], acknowledgePrivateMetadata: false })).toBe(
      true,
    );
    expect(
      isTemplateValid({ claims: [mapping({ name: "sub" })], acknowledgePrivateMetadata: false }),
    ).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("carries a claim from every source, in template order", () => {
    const rendered = renderTemplate(
      [
        mapping({ name: "plan", source: "metadata_public", path: "plan" }),
        mapping({ name: "email" }),
        mapping({ name: "org", source: "metadata_private", path: "orgId" }),
      ],
      complete,
    );
    expect(rendered.present.map((c) => [c.name, c.value])).toEqual([
      ["plan", "pro"],
      ["email", "ada@example.com"],
      ["org", "org_7f3a"],
    ]);
    expect(rendered.absent).toEqual([]);
    expect(rendered.refusedBy).toBeNull();
    expect(rendered.overBudget).toBe(false);
  });

  it("leaves an optional claim out rather than emitting null", () => {
    const phone = mapping({ name: "phone", path: "phone" });
    const rendered = renderTemplate([phone], sparse);
    expect(rendered.present).toEqual([]);
    expect(rendered.absent).toEqual([phone]);
    expect(rendered.bytes).toBe(2);
  });

  it("refuses the sign-in on the first required claim that resolves to nothing", () => {
    const rendered = renderTemplate(
      [
        mapping({ name: "email" }),
        mapping({ name: "name", path: "displayName", required: true }),
        mapping({ name: "phone", path: "phone", required: true }),
      ],
      sparse,
    );
    expect(rendered.refusedBy?.name).toBe("name");
    expect(rendered.present.map((c) => c.name)).toEqual(["email"]);
  });

  it("measures the rendered bytes and says when they outgrow the budget", () => {
    const rendered = renderTemplate([mapping({ name: "email" })], complete);
    expect(rendered.bytes).toBe(JSON.stringify({ email: "ada@example.com" }).length);
    const blob = {
      ...complete,
      metadataPublic: { bio: "x".repeat(MAX_CLAIM_BYTES) },
    };
    expect(
      renderTemplate([mapping({ name: "bio", source: "metadata_public", path: "bio" })], blob)
        .overBudget,
    ).toBe(true);
  });

  it("skips a mapping with no name or a name already rendered", () => {
    const rendered = renderTemplate(
      [mapping({ name: "" }), mapping({ name: "email" }), mapping({ name: "email" })],
      complete,
    );
    expect(rendered.present).toHaveLength(1);
  });
});

describe("assembledClaims", () => {
  it("names the user, the project and a five-minute life, and never a custom claim", () => {
    const claims = assembledClaims(complete, "prj_acme", new Date("2026-09-09T12:00:00Z"));
    expect(claims["sub"]).toBe(complete.id);
    expect(claims["aud"]).toBe("prj_acme");
    expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(300);
    for (const name of Object.keys(claims)) expect(RESERVED_CLAIMS).toContain(name);
  });
});

describe("SAMPLE_PROFILES", () => {
  it("holds an account with no address, which is who a required email claim locks out", () => {
    expect(phoneOnly.email).toBeNull();
    expect(phoneOnly.phone).not.toBeNull();
    const rendered = renderTemplate([mapping({ required: true })], phoneOnly);
    expect(rendered.refusedBy?.name).toBe("email");
  });

  it("gives every profile a short name, because a segment cannot carry the long one", () => {
    for (const profile of SAMPLE_PROFILES) expect(profile.short).not.toBe("");
  });
});

describe("templateChanges", () => {
  const template = (claims: ClaimMapping[]) => ({ claims, acknowledgePrivateMetadata: false });

  it("says nothing about a draft that matches what is published", () => {
    const claims = [mapping({ name: "plan", source: "metadata_public", path: "plan" })];
    expect(templateChanges(template(claims), template([...claims]))).toEqual([]);
  });

  it("names what is added, what goes, and what moved", () => {
    const before = template([mapping({ name: "email" }), mapping({ name: "old", path: "phone" })]);
    const after = template([
      mapping({ name: "email", path: "displayName" }),
      mapping({ name: "plan", source: "metadata_public", path: "plan", required: true }),
    ]);
    const changes = templateChanges(before, after);
    expect(changes.map((change) => [change.kind, change.name])).toEqual([
      ["changed", "email"],
      ["added", "plan"],
      ["removed", "old"],
    ]);
    expect(changes[0]?.detail).toContain("profile.displayName");
    expect(changes[1]?.detail).toContain("required");
  });

  it("reports becoming required, which is the change that can refuse a sign-in", () => {
    const before = template([mapping({ name: "email" })]);
    const after = template([mapping({ name: "email", required: true })]);
    expect(templateChanges(before, after)).toEqual([
      { kind: "changed", name: "email", detail: "becomes required" },
    ]);
  });

  it("counts a reshuffle, because the order is the order a token writes them in", () => {
    const two = [mapping({ name: "a" }), mapping({ name: "b" })];
    const changes = templateChanges(
      { claims: two, acknowledgePrivateMetadata: false },
      { claims: [...two].reverse(), acknowledgePrivateMetadata: false },
    );
    expect(changes.map((change) => change.kind)).toEqual(["reordered"]);
  });

  it("ignores a claim with no name yet, which cannot be published and so changes nothing", () => {
    expect(templateChanges(template([]), template([mapping({ name: "  " })]))).toEqual([]);
  });

  it("spells a source as the column it comes out of", () => {
    expect(claimPathText(mapping({}))).toBe("profile.email");
    expect(claimPathText(mapping({ source: "metadata_private", path: "orgId" }))).toBe(
      "metadata_private.orgId",
    );
  });
});

describe("tokenLines", () => {
  const assembled = { sub: "usr_1", aud: "prj_acme" };

  it("marks nothing when there is no published template to compare to", () => {
    const after = renderTemplate([mapping({ name: "email" })], complete);
    const lines = tokenLines(assembled, after, null);
    expect(lines.every((line) => line.change === "same")).toBe(true);
    expect(lines.filter((line) => line.custom)).toHaveLength(1);
  });

  it("marks an added, a changed and a removed claim against the published render", () => {
    const before = renderTemplate(
      [mapping({ name: "email" }), mapping({ name: "gone", path: "displayName" })],
      complete,
    );
    const after = renderTemplate(
      [mapping({ name: "email", path: "displayName" }), mapping({ name: "fresh", path: "phone" })],
      complete,
    );
    const marks = Object.fromEntries(
      tokenLines(assembled, after, before)
        .filter((line) => line.custom)
        .map((line) => [line.key, line.change]),
    );
    expect(marks).toEqual({
      "claim-email": "changed",
      "claim-fresh": "added",
      "gone-gone": "removed",
    });
  });

  /* The block is handed to a JSON grammar whole, so it has to be valid JSON however the
     draft differs: a separator missing anywhere but the end tokenises as the error it is. */
  it("commas every line but the last, a removed one included", () => {
    const before = renderTemplate([mapping({ name: "gone" })], complete);
    const after = renderTemplate([mapping({ name: "email" })], complete);
    const lines = tokenLines(assembled, after, before);
    expect(lines.at(-1)?.change).toBe("removed");
    expect(lines.at(-1)?.text.endsWith(",")).toBe(false);
    expect(lines.slice(0, -1).every((line) => line.text.endsWith(","))).toBe(true);
  });
});

describe("profileOutcomes", () => {
  it("answers for every sample user, and names the ones a required claim locks out", () => {
    const claims = [mapping({ required: true })];
    const outcomes = profileOutcomes(claims, [], true);
    expect(outcomes).toHaveLength(SAMPLE_PROFILES.length);
    expect(refusedProfiles(outcomes).map((entry) => entry.profile.id)).toEqual(["phone"]);
  });

  it("carries no before while the draft matches what is published", () => {
    const outcomes = profileOutcomes([mapping({})], [mapping({})], false);
    expect(outcomes.every((entry) => entry.before === null)).toBe(true);
    expect(outcomes[1]?.rendered.absent).toEqual([]);
    expect(outcomes[1]?.rendered.present.map((claim) => claim.value)).toEqual([sparse.email]);
  });
});

describe("defaultClaimName", () => {
  it("takes the key as it is, and steps around what would be refused or taken", () => {
    expect(defaultClaimName("plan", [])).toBe("plan");
    expect(defaultClaimName("plan", ["plan"])).toBe("plan_2");
    expect(defaultClaimName("plan", ["plan", "plan_2"])).toBe("plan_3");
    expect(defaultClaimName("sub", [])).toBe("sub_claim");
    expect(defaultClaimName("has space!", [])).toBe("has_space_");
    expect(defaultClaimName("", [])).toBe("claim");
  });
});

describe("isSameTemplate", () => {
  it("ignores whitespace and nothing else, order included", () => {
    const a = { claims: [mapping({ name: " plan " })], acknowledgePrivateMetadata: false };
    const b = { claims: [mapping({ name: "plan" })], acknowledgePrivateMetadata: false };
    expect(isSameTemplate(a, b)).toBe(true);
    const priv = [mapping({ name: "org", source: "metadata_private", path: "orgId" })];
    expect(
      isSameTemplate(
        { claims: priv, acknowledgePrivateMetadata: false },
        { claims: priv, acknowledgePrivateMetadata: true },
      ),
    ).toBe(false);
    const two = [mapping({ name: "a" }), mapping({ name: "b" })];
    expect(
      isSameTemplate(
        { claims: two, acknowledgePrivateMetadata: false },
        { claims: [...two].reverse(), acknowledgePrivateMetadata: false },
      ),
    ).toBe(false);
  });

  it("forgets an acknowledgement once nothing reads private metadata, as the server does", () => {
    expect(
      isSameTemplate(
        { claims: [mapping({})], acknowledgePrivateMetadata: true },
        { claims: [mapping({})], acknowledgePrivateMetadata: false },
      ),
    ).toBe(true);
  });
});
