import { describe, expect, it } from "vitest";
import {
  afterAccountRemoved,
  afterAccountSaved,
  BYO_VENDORS,
  type ByoAccount,
  byoVendorInfo,
  formatPrice,
  isAllowed,
  isByoKey,
  priceFor,
  priceRange,
  providerInfo,
  providerLabel,
  REGISTRATIONS,
  routeFor,
  type SendingState,
  SMS_MARGIN,
  SMS_PROVIDERS,
  SMS_ROUTES,
  validateByo,
  withMode,
} from "../../app/utils/sms-providers";

const ACCOUNT: ByoAccount = {
  vendor: "twilio",
  key: "AC7f3c1d90ab5e42d8b6104f27ce9a3b55",
  secretSet: true,
  secretUpdatedAt: "2026-08-02T11:15:00.000Z",
};

describe("what a message costs", () => {
  it("adds the margin the price list states and rounds where the rates do", () => {
    expect(SMS_MARGIN).toBe(0.25);
    expect(priceFor(0.0096)).toBe(0.012);
    expect(priceFor(0.032)).toBe(0.04);
    expect(priceFor(0.0032)).toBe(0.004);
  });

  it("prices the United States at the figure PROJECT.md quotes", () => {
    const route = routeFor("US");
    expect(route).not.toBeNull();
    expect(priceFor(route?.wholesale ?? 0)).toBe(0.012);
  });

  it("writes every price to the same four places, so a column lines up", () => {
    expect(formatPrice(0.012)).toBe("$0.0120");
    expect(formatPrice(0.004)).toBe("$0.0040");
    expect(formatPrice(0.09)).toBe("$0.0900");
  });

  it("reports the range the table actually spans", () => {
    const { low, high } = priceRange(SMS_ROUTES);
    expect(low).toBeLessThan(high);
    expect(low).toBe(Math.min(...SMS_ROUTES.map((route) => priceFor(route.wholesale))));
  });
});

describe("the routing table", () => {
  it("names each country once, because a second row would be a second answer", () => {
    const codes = SMS_ROUTES.map((route) => route.country);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses ISO codes and never a dialling prefix", () => {
    for (const route of SMS_ROUTES) {
      expect(route.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("routes only to vendors the catalogue knows", () => {
    for (const route of SMS_ROUTES) {
      expect(providerInfo(route.provider)).not.toBeNull();
      if (route.failover !== null) expect(providerInfo(route.failover)).not.toBeNull();
    }
  });

  it("never falls back to the vendor it is already using", () => {
    for (const route of SMS_ROUTES) {
      if (route.failover !== null) expect(route.failover).not.toBe(route.provider);
    }
  });

  it("never routes anything to the development transport", () => {
    for (const route of SMS_ROUTES) {
      expect(route.provider).not.toBe("logging");
      expect(route.failover).not.toBe("logging");
    }
  });

  it("costs something everywhere, since a free route is a rate nobody entered", () => {
    for (const route of SMS_ROUTES) {
      expect(route.wholesale).toBeGreaterThan(0);
    }
  });

  it("finds a route however the code was cased, and nothing for one it has not got", () => {
    expect(routeFor("gb")?.country).toBe("GB");
    expect(routeFor("ZZ")).toBeNull();
  });

  it("says which registrations stop a country sending until they are filed", () => {
    const blocking = Object.values(REGISTRATIONS)
      .filter((entry) => entry.blocking)
      .map((entry) => entry.id);
    expect(blocking).toEqual(["10dlc", "dlt", "iys", "sender_id"]);
    expect(REGISTRATIONS.none.blocking).toBe(false);
  });
});

describe("the allowlist", () => {
  it("matches whatever case the policy stored", () => {
    expect(isAllowed("US", ["us", "gb"])).toBe(true);
    expect(isAllowed("de", ["US", "GB"])).toBe(false);
  });

  it("allows nothing when the project has allowed nothing", () => {
    for (const route of SMS_ROUTES) {
      expect(isAllowed(route.country, [])).toBe(false);
    }
  });
});

describe("the vendor catalogue", () => {
  it("names each vendor once and says what each is for", () => {
    expect(new Set(SMS_PROVIDERS.map((entry) => entry.id)).size).toBe(SMS_PROVIDERS.length);
    for (const provider of SMS_PROVIDERS) {
      expect(provider.note.length).toBeGreaterThan(0);
      expect(providerLabel(provider.id)).toBe(provider.label);
    }
  });

  it("keeps the development transport out of production", () => {
    expect(providerInfo("logging")?.state).toBe("development");
  });

  it("offers exactly the two vendors a customer may bring", () => {
    expect(BYO_VENDORS.map((vendor) => vendor.id)).toEqual(["twilio", "vonage"]);
    expect(byoVendorInfo("twilio")?.keyLabel).toBe("Account SID");
  });
});

describe("a customer's own credentials", () => {
  it("refuses a key that is not that vendor's shape, before anything is stored", () => {
    expect(isByoKey("twilio", ACCOUNT.key)).toBe(true);
    expect(isByoKey("twilio", "SK7f3c1d90ab5e42d8b6104f27ce9a3b55")).toBe(false);
    expect(isByoKey("twilio", "AC123")).toBe(false);
    expect(isByoKey("vonage", "a1b2c3d4")).toBe(true);
    expect(isByoKey("vonage", ACCOUNT.key)).toBe(false);
  });

  it("requires a secret on a first write and not on a later one", () => {
    const draft = { vendor: "twilio" as const, key: ACCOUNT.key, secret: "" };
    expect(validateByo(draft, false)).toBe("secret_missing");
    expect(validateByo(draft, true)).toBeNull();
  });

  it("reports the key before the secret, because a bad key is the visible mistake", () => {
    expect(validateByo({ vendor: "twilio", key: "nope", secret: "" }, false)).toBe("key_invalid");
  });
});

describe("whose account carries it", () => {
  const managed: SendingState = { mode: "managed", account: null };
  const own: SendingState = { mode: "byo", account: ACCOUNT };

  it("moves onto the customer's account when credentials are saved", () => {
    expect(afterAccountSaved(ACCOUNT)).toEqual({ mode: "byo", account: ACCOUNT });
  });

  it("hands the project back to our routing when the account goes", () => {
    expect(afterAccountRemoved()).toEqual({ mode: "managed", account: null });
  });

  it("refuses to sit on a vendor the project has no credentials for", () => {
    expect(withMode(managed, "byo")).toEqual(managed);
  });

  it("moves either way once an account is stored", () => {
    expect(withMode(own, "managed").mode).toBe("managed");
    expect(withMode(withMode(own, "managed"), "byo").mode).toBe("byo");
  });

  it("never leaves a project on a vendor with nothing behind it", () => {
    for (const state of [managed, own, withMode(own, "managed"), afterAccountRemoved()]) {
      if (state.mode === "byo") expect(state.account).not.toBeNull();
    }
  });
});
