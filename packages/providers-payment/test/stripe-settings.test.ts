import { describe, expect, it } from "vitest";
import { stripeSettingsFrom } from "../src/stripe-settings.js";

const FULL = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_API_VERSION: "2026-08-26.dahlia",
  STRIPE_CHECKOUT_SUCCESS_URL: "https://app.test/billing/wallet?checkout=success",
  STRIPE_CHECKOUT_CANCEL_URL: "https://app.test/billing/wallet?checkout=cancel",
};

/**
 * The gate in front of the payment provider.
 *
 * It exists for one failure and the tests are shaped around it: a deployment holding three
 * of the four required variables would start, put a customer through a checkout, and be
 * unable to verify what came back — money charged and no credit granted. That is the one
 * outcome on this path nobody can be asked to shrug off, so it is a boot failure.
 */
describe("deciding whether payments are configured", () => {
  it("builds the settings when everything is there", () => {
    expect(stripeSettingsFrom(FULL)).toMatchObject({
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
      apiVersion: "2026-08-26.dahlia",
    });
  });

  /** A deployment that takes no payments is correct, not degraded. */
  it("answers null when none of them is set", () => {
    expect(stripeSettingsFrom({ STRIPE_API_VERSION: "2026-08-26.dahlia" })).toBeNull();
  });

  it("refuses a partial set, naming what is missing", () => {
    for (const missing of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_CHECKOUT_SUCCESS_URL",
      "STRIPE_CHECKOUT_CANCEL_URL",
    ] as const) {
      const partial = { ...FULL, [missing]: undefined };
      expect(() => stripeSettingsFrom(partial), missing).toThrowError();
      try {
        stripeSettingsFrom(partial);
      } catch (error: unknown) {
        expect(JSON.stringify(error), missing).toContain(missing);
      }
    }
  });

  /** An empty string is not a value. A shell that exported nothing sets one. */
  it("treats an empty string as absent", () => {
    expect(() => stripeSettingsFrom({ ...FULL, STRIPE_WEBHOOK_SECRET: "" })).toThrowError();
  });
});
