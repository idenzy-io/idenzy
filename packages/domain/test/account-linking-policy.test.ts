import { IdentityAlreadyLinkedError } from "@idenzy/core/errors/errors";
import { describe, expect, it } from "vitest";
import { AccountLinkingPolicy, LinkDecision } from "../src/policies/account-linking-policy.js";

const ALICE = "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6e";
const BOB = "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6f";

describe("account linking", () => {
  const policy = new AccountLinkingPolicy();

  it("signs in a returning user without consulting the email at all", () => {
    const outcome = policy.decide({
      linkedUserId: ALICE,
      userIdWithSameEmail: BOB,
      providerAssertsVerifiedEmail: false,
    });
    expect(outcome).toEqual({ decision: LinkDecision.LinkExisting, userId: ALICE });
  });

  it("creates a user when nothing matches", () => {
    const outcome = policy.decide({
      linkedUserId: null,
      userIdWithSameEmail: null,
      providerAssertsVerifiedEmail: true,
    });
    expect(outcome).toEqual({ decision: LinkDecision.CreateUser, userId: null });
  });

  it("links on an address the provider verified", () => {
    const outcome = policy.decide({
      linkedUserId: null,
      userIdWithSameEmail: ALICE,
      providerAssertsVerifiedEmail: true,
    });
    expect(outcome).toEqual({ decision: LinkDecision.LinkExisting, userId: ALICE });
  });

  // The attack: a provider that lets anyone claim an unverified address would otherwise
  // hand over every account holding it (PROJECT.md 4.6).
  it("refuses to link on an unverified address and demands proof", () => {
    const outcome = policy.decide({
      linkedUserId: null,
      userIdWithSameEmail: ALICE,
      providerAssertsVerifiedEmail: false,
    });
    expect(outcome).toEqual({ decision: LinkDecision.RequireVerification, userId: ALICE });
  });

  it("still demands proof when the project turned auto-linking off", () => {
    const strict = new AccountLinkingPolicy(false);
    const outcome = strict.decide({
      linkedUserId: null,
      userIdWithSameEmail: ALICE,
      providerAssertsVerifiedEmail: true,
    });
    expect(outcome.decision).toBe(LinkDecision.RequireVerification);
  });
});

describe("linking into an existing session", () => {
  const policy = new AccountLinkingPolicy();

  it("allows re-linking the account the user already holds", () => {
    expect(() => policy.assertLinkable(ALICE, ALICE)).not.toThrow();
    expect(() => policy.assertLinkable(null, ALICE)).not.toThrow();
  });

  it("refuses a provider account that belongs to someone else", () => {
    expect(() => policy.assertLinkable(BOB, ALICE)).toThrow(IdentityAlreadyLinkedError);
  });
});
