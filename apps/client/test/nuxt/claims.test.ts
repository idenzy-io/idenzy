import { describe, expect, it } from "vitest";
import {
  assembledClaims,
  CLAIMABLE_USER_FIELDS,
  type ClaimMapping,
  defaultClaimName,
  isSameTemplate,
  isTemplateValid,
  MAX_CLAIM_BYTES,
  MAX_CLAIMS,
  namesBytes,
  RESERVED_CLAIMS,
  renderTemplate,
  SAMPLE_PROFILES,
  type SampleProfile,
  validateMapping,
  validateTemplate,
} from "../../app/utils/claims";

/* Two profiles the file promises; a missing one fails the first assertion below. */
const complete = (SAMPLE_PROFILES[0] as SampleProfile).user;
const sparse = (SAMPLE_PROFILES[1] as SampleProfile).user;

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
