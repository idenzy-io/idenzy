import { describe, expect, it } from "vitest";
import {
  afterAccountRemoved,
  afterAccountSaved,
  BYO_VENDORS,
  type ByoAccount,
  byoVendorInfo,
  CARRIERS,
  DESTINATION_FILTERS,
  formatPrice,
  isAllowed,
  isByoKey,
  liveTransport,
  priceFor,
  priceRange,
  providerInfo,
  providerLabel,
  RATE_SOURCE,
  REGISTRATIONS,
  routeFor,
  routeReadiness,
  type SendingState,
  SMS_MARGIN,
  SMS_PROVIDERS,
  SMS_ROUTES,
  transportWired,
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

describe("what this deployment can actually do", () => {
  it("calls no vendor live, because every adapter is a port with nothing behind it", () => {
    expect(SMS_PROVIDERS.filter((provider) => provider.state === "live")).toEqual([]);
    expect(transportWired()).toBe(false);
    expect(liveTransport()).toBeNull();
  });

  it("keeps the two headline vendors out of the state that reads as carrying traffic", () => {
    expect(providerInfo("twilio")?.state).toBe("planned");
    expect(providerInfo("aws")?.state).toBe("planned");
  });

  it("offers the carriers without the development transport among them", () => {
    expect(CARRIERS.map((provider) => provider.id)).not.toContain("logging");
  });

  it("says where a rate came from, so a price is never read as a quote", () => {
    expect(RATE_SOURCE).toMatch(/not.*live price feed|rather than read from a live price feed/i);
  });
});

describe("routeReadiness", () => {
  const us = routeFor("US");
  const gb = routeFor("GB");

  it("puts the allowlist first, because it is the project's own and it is free", () => {
    const answer = routeReadiness(us!, []);
    expect(answer.state).toBe("not_allowed");
    expect(answer.fix?.to).toBe("/sms/policy");
  });

  it("names the registration that is in the way once the country is allowed", () => {
    const answer = routeReadiness(us!, ["US"]);
    expect(answer.state).toBe("registration");
    expect(answer.label).toBe("Needs 10DLC");
  });

  it("reads a country as ready where nothing has to be filed", () => {
    const answer = routeReadiness(gb!, ["GB"]);
    expect(answer.state).toBe("ready");
    expect(answer.fix).toBeNull();
  });

  it("sends every fix to a setup flow rather than to a general guide", () => {
    for (const route of SMS_ROUTES) {
      const answer = routeReadiness(route, [route.country]);
      if (answer.fix === null) continue;
      expect(answer.fix.to ?? answer.fix.href).toMatch(/^(\/sms\/policy|https:\/\/idenzy\.dev\/)/);
    }
  });
});

describe("the destinations filter", () => {
  it("opens on the project's own countries, which is the question somebody arrived with", () => {
    expect(DESTINATION_FILTERS[0]?.value).toBe("allowed_first");
  });

  it("offers the three the note names and nothing else", () => {
    expect(DESTINATION_FILTERS.map((entry) => entry.value)).toEqual([
      "allowed_first",
      "allowed_only",
      "all",
    ]);
  });
});
