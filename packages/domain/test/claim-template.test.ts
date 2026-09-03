import { ClaimSource, MAX_CLAIM_BYTES } from "@idenzy/protocol/schemas/claims";
import { describe, expect, it } from "vitest";
import { User, type UserState } from "../src/entities/user.js";
import { ClaimTemplate } from "../src/policies/claim-template.js";

function user(overrides: Partial<UserState> = {}): User {
  return new User({
    id: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    email: "ada@example.test",
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: null,
    passwordAlgoVersion: null,
    displayName: "Ada",
    avatarUrl: null,
    metadataPublic: { plan: "pro" },
    metadataPrivate: { stripeCustomerId: "cus_123" },
    bannedUntil: null,
    lastSignInAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  });
}

describe("rendering a claim template", () => {
  it("carries nothing when nothing is configured", () => {
    expect(ClaimTemplate.empty().render(user())).toEqual({});
  });

  it("reads a user field through the public profile", () => {
    const template = ClaimTemplate.of([
      { name: "email", source: ClaimSource.User, path: "email", required: false },
      { name: "name", source: ClaimSource.User, path: "displayName", required: false },
    ]);

    expect(template.render(user())).toEqual({ email: "ada@example.test", name: "Ada" });
  });

  it("reads a metadata key by name", () => {
    const template = ClaimTemplate.of([
      { name: "plan", source: ClaimSource.MetadataPublic, path: "plan", required: false },
      {
        name: "billing_id",
        source: ClaimSource.MetadataPrivate,
        path: "stripeCustomerId",
        required: false,
      },
    ]);

    expect(template.render(user())).toEqual({ plan: "pro", billing_id: "cus_123" });
  });

  /**
   * A verifier reading `null` has to decide what it means, and every one of them decides
   * differently. Absent is the answer with no ambiguity in it.
   */
  it("omits a claim that resolves to nothing rather than emitting null", () => {
    const template = ClaimTemplate.of([
      { name: "phone", source: ClaimSource.User, path: "phone", required: false },
      { name: "tier", source: ClaimSource.MetadataPublic, path: "absent", required: false },
    ]);

    expect(template.render(user())).toEqual({});
  });

  /**
   * The rule that makes a template worth branching on. A claim an authorisation check
   * reads is one where absent and false are the same answer.
   */
  it("refuses to issue when a required claim resolves to nothing", () => {
    const template = ClaimTemplate.of([
      { name: "org", source: ClaimSource.MetadataPublic, path: "orgId", required: true },
    ]);

    expect(() => template.render(user())).toThrowError(
      expect.objectContaining({ code: "claim_template_unsatisfied" }),
    );
  });

  it("refuses when the rendered claims are larger than a token may carry", () => {
    const template = ClaimTemplate.of([
      { name: "blob", source: ClaimSource.MetadataPublic, path: "blob", required: false },
    ]);
    const big = user({ metadataPublic: { blob: "x".repeat(MAX_CLAIM_BYTES + 1) } });

    expect(() => template.render(big)).toThrowError(
      expect.objectContaining({ code: "claim_template_unsatisfied" }),
    );
  });

  /** The public profile is the allowlist, so nothing outside it is reachable by path. */
  it("cannot reach a field the public profile does not have", () => {
    const template = ClaimTemplate.of([
      { name: "pw", source: ClaimSource.User, path: "passwordHash", required: false },
    ]);

    expect(template.render(user({ passwordHash: "$argon2id$..." }))).toEqual({});
  });

  it("still refuses when such a field is marked required", () => {
    const template = ClaimTemplate.of([
      { name: "pw", source: ClaimSource.User, path: "passwordHash", required: true },
    ]);

    expect(() => template.render(user({ passwordHash: "$argon2id$..." }))).toThrowError(
      expect.objectContaining({ code: "claim_template_unsatisfied" }),
    );
  });
});
