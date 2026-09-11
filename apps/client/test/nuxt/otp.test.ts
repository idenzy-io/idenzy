import { describe, expect, it } from "vitest";
import {
  channelBlockers,
  channelChecks,
  channelFacts,
  channelJourney,
  channelState,
  channelSummary,
  formatMoney,
  humanizeSeconds,
  measureSms,
  type OtpSetup,
  parseRedirectUri,
  renderPreview,
  SAMPLE_CODE,
  TEMPLATES,
  validateRedirectUri,
} from "../../app/utils/otp";
import { canSendSms, type SmsPolicy } from "../../app/utils/sms-policy";

describe("validateRedirectUri", () => {
  it("takes an absolute https URL, path and query included", () => {
    expect(validateRedirectUri("https://app.example.com/auth/link")).toBeNull();
    expect(validateRedirectUri("https://app.example.com/auth/link?next=%2Fhome")).toBeNull();
    expect(validateRedirectUri("  https://app.example.com/auth/link  ")).toBeNull();
  });

  it("takes an app scheme with an authority and refuses a scheme alone", () => {
    expect(validateRedirectUri("myapp://auth/link")).toBeNull();
    expect(validateRedirectUri("javascript:alert(1)")).toBe("redirect_invalid");
    expect(validateRedirectUri("mailto:someone@example.com")).toBe("redirect_invalid");
  });

  it("wants https away from localhost", () => {
    expect(validateRedirectUri("http://localhost:3000/auth/link")).toBeNull();
    expect(validateRedirectUri("http://127.0.0.1:3000/auth/link")).toBeNull();
    expect(validateRedirectUri("http://app.example.com/auth/link")).toBe("redirect_insecure");
  });

  it("refuses what is not a URL, credentials, a fragment and a code of its own", () => {
    expect(validateRedirectUri("app.example.com/auth/link")).toBe("redirect_invalid");
    expect(validateRedirectUri("https://app.example.com/auth link")).toBe("redirect_invalid");
    expect(validateRedirectUri("https://user:pw@app.example.com/")).toBe("redirect_invalid");
    expect(validateRedirectUri("https://app.example.com/auth/link#done")).toBe("redirect_fragment");
    expect(validateRedirectUri("https://app.example.com/auth/link#")).toBe("redirect_fragment");
    expect(validateRedirectUri("https://app.example.com/auth?code=x")).toBe("redirect_code_param");
  });

  it("parses without changing the text, because the server compares it as given", () => {
    expect(parseRedirectUri("https://App.Example.com/Auth/")?.href).toBe(
      "https://app.example.com/Auth/",
    );
    expect(parseRedirectUri("")).toBeNull();
  });
});

describe("renderPreview", () => {
  it("fills the code, the project and how long it lasts", () => {
    expect(renderPreview(TEMPLATES.emailOtpSubject, "Acme Inc.")).toBe(
      `${SAMPLE_CODE} is your Acme Inc. sign-in code`,
    );
    expect(renderPreview(TEMPLATES.smsOtpBody, "Acme Inc.")).toBe(
      `${SAMPLE_CODE} is your Acme Inc. code. It expires in 10 minutes. Do not share it.`,
    );
    expect(renderPreview(TEMPLATES.magicLinkSubject, "Acme Inc.", 300)).toBe(
      "Sign in to Acme Inc.",
    );
  });

  it("keeps the built-in SMS inside one GSM-7 segment for an ordinary project name", () => {
    const body = renderPreview(TEMPLATES.smsOtpBody, "Acme Inc.");
    expect(measureSms(body)).toEqual({ encoding: "gsm-7", units: body.length, segments: 1 });
  });
});

describe("humanizeSeconds", () => {
  it("rounds the way the mailer and the texter do", () => {
    expect(humanizeSeconds(45)).toBe("45 seconds");
    expect(humanizeSeconds(90)).toBe("2 minutes");
    expect(humanizeSeconds(600)).toBe("10 minutes");
    expect(humanizeSeconds(3600)).toBe("60 minutes");
    expect(humanizeSeconds(7200)).toBe("2 hours");
    expect(humanizeSeconds(172_800)).toBe("2 days");
  });
});

describe("measureSms", () => {
  it("bills by segment and not by character", () => {
    expect(measureSms("").segments).toBe(0);
    expect(measureSms("a".repeat(160))).toEqual({ encoding: "gsm-7", units: 160, segments: 1 });
    expect(measureSms("a".repeat(161))).toEqual({ encoding: "gsm-7", units: 161, segments: 2 });
    expect(measureSms("a".repeat(307)).segments).toBe(3);
  });

  it("charges two septets for an escaped character", () => {
    expect(measureSms("100€").units).toBe(5);
    expect(measureSms(`${"a".repeat(159)}€`).segments).toBe(2);
  });

  it("drops the whole message to UCS-2 for one character outside GSM-7", () => {
    const curly = `Don${"’"}t share it. ${"a".repeat(60)}`;
    expect(measureSms(curly)).toEqual({ encoding: "ucs-2", units: curly.length, segments: 2 });
    expect(measureSms(`${"a".repeat(69)}😀`)).toEqual({
      encoding: "ucs-2",
      units: 71,
      segments: 2,
    });
  });
});

describe("formatMoney", () => {
  it("writes the currency in English and survives a currency it does not know", () => {
    expect(formatMoney(6.42, "USD")).toBe("$6.42");
    expect(formatMoney(25, "EUR")).toBe("€25.00");
    expect(formatMoney(3, "NOPE")).toBe("3.00 NOPE");
  });
});

describe("canSendSms", () => {
  const policy: SmsPolicy = {
    allowedCountries: ["US"],
    dailySpendCap: 2,
    currency: "USD",
    attestationRequired: true,
    perNumberDailyLimit: 5,
    perIpHourlyLimit: 10,
    maxSendsPerVerify: 6,
    senderId: null,
  };

  it("reads no row and an empty allowlist as the same no", () => {
    expect(canSendSms(null)).toBe(false);
    expect(canSendSms({ ...policy, allowedCountries: [] })).toBe(false);
    expect(canSendSms(policy)).toBe(true);
  });
});

/*
 * Readiness. The point of these is that a channel can be switched on and deliver nothing,
 * and that what is stopping it usually lives on another screen.
 */

const POLICY: SmsPolicy = {
  allowedCountries: ["US"],
  dailySpendCap: 2,
  currency: "USD",
  attestationRequired: true,
  perNumberDailyLimit: 5,
  perIpHourlyLimit: 10,
  maxSendsPerVerify: 6,
  senderId: null,
};

function setupOf(change: Partial<OtpSetup> = {}): OtpSetup {
  return {
    settings: {
      email: { enabled: true, allowSignUp: true },
      sms: { enabled: true, allowSignUp: true },
      magicLink: {
        enabled: true,
        allowSignUp: true,
        redirectUris: ["https://app.example.com/auth/callback"],
      },
    },
    sending: { domain: "mail.example.com", verified: true, shared: false },
    suppressed: { email: 0, sms: 0 },
    policy: POLICY,
    spentToday: 0,
    attestationWired: true,
    delivery: { ready: true, label: "Sent through our own routing" },
    allowedOrigins: ["https://app.example.com"],
    ...change,
  };
}

const idsOf = (checks: readonly { id: string }[]) => checks.map((check) => check.id);

describe("channelChecks", () => {
  it("passes every channel on a project that is actually set up", () => {
    for (const id of ["email", "sms", "link"] as const) {
      expect(channelBlockers(id, setupOf())).toEqual([]);
    }
  });

  it("blocks every mailed channel where the project sends from nowhere", () => {
    const setup = setupOf({ sending: null });
    expect(idsOf(channelBlockers("email", setup))).toContain("sending-domain");
    expect(idsOf(channelBlockers("link", setup))).toContain("sending-domain");
    expect(idsOf(channelBlockers("sms", setup))).toEqual([]);
  });

  it("reads a domain whose records are not found yet as blocking, not as a warning", () => {
    const setup = setupOf({
      sending: { domain: "mail.example.com", verified: false, shared: false },
    });
    expect(idsOf(channelBlockers("email", setup))).toContain("sending-domain");
  });

  it("warns rather than blocks on the shared domain, which does deliver", () => {
    const setup = setupOf({ sending: { domain: "idenzy.email", verified: true, shared: true } });
    expect(channelBlockers("email", setup)).toEqual([]);
    const check = channelChecks("email", setup).find((entry) => entry.id === "sending-domain");
    expect(check?.state).toBe("warn");
  });

  it("reads no SMS policy and an empty allowlist as the same refusal", () => {
    expect(idsOf(channelBlockers("sms", setupOf({ policy: null })))).toContain("countries");
    expect(
      idsOf(channelBlockers("sms", setupOf({ policy: { ...POLICY, allowedCountries: [] } }))),
    ).toContain("countries");
  });

  it("blocks SMS where attestation is required and nothing can satisfy it", () => {
    const setup = setupOf({ attestationWired: false });
    expect(idsOf(channelBlockers("sms", setup))).toEqual(["attestation"]);
  });

  it("warns rather than blocks where attestation is not required at all", () => {
    const setup = setupOf({
      policy: { ...POLICY, attestationRequired: false },
      attestationWired: false,
    });
    expect(channelBlockers("sms", setup)).toEqual([]);
    const check = channelChecks("sms", setup).find((entry) => entry.id === "attestation");
    expect(check?.state).toBe("warn");
  });

  it("blocks SMS on the day's cap and warns as it is approached", () => {
    expect(idsOf(channelBlockers("sms", setupOf({ spentToday: 2 })))).toContain("spend-cap");
    const near = channelChecks("sms", setupOf({ spentToday: 1.8 })).find(
      (entry) => entry.id === "spend-cap",
    );
    expect(near?.state).toBe("warn");
  });

  it("blocks SMS where the project brought an account it never finished wiring", () => {
    const setup = setupOf({
      delivery: { ready: false, label: "Your own Twilio account has no auth token stored" },
    });
    expect(idsOf(channelBlockers("sms", setup))).toContain("delivery");
  });

  it("blocks a link whose return URL sits on an origin the API will not answer", () => {
    const setup = setupOf({ allowedOrigins: [] });
    expect(idsOf(channelBlockers("link", setup))).toEqual(["origins"]);
  });

  it("counts neither a native scheme nor a loopback URL against the CORS allowlist", () => {
    const setup = setupOf({
      allowedOrigins: [],
      settings: {
        ...setupOf().settings,
        magicLink: {
          enabled: true,
          allowSignUp: true,
          redirectUris: ["myapp://auth", "http://localhost:3000/auth/callback"],
        },
      },
    });
    expect(channelBlockers("link", setup)).toEqual([]);
  });

  it("blocks a link with nowhere to land", () => {
    const setup = setupOf({
      settings: {
        ...setupOf().settings,
        magicLink: { enabled: true, allowSignUp: true, redirectUris: [] },
      },
    });
    expect(idsOf(channelBlockers("link", setup))).toContain("return-urls");
  });

  it("never asks a customer to fix the confirmation route somewhere else", () => {
    const check = channelChecks("link", setupOf()).find(
      (entry) => entry.id === "confirmation-route",
    );
    expect(check?.state).toBe("warn");
    expect(check?.fix).toBeUndefined();
  });
});

describe("channelState", () => {
  it("says off for a channel nobody turned on, whatever else is wrong", () => {
    const setup = setupOf({
      policy: null,
      settings: { ...setupOf().settings, sms: { enabled: false, allowSignUp: true } },
    });
    expect(channelState("sms", setup)).toEqual({ label: "Off", tone: "neutral" });
  });

  it("separates a channel that is on and stuck from one that is on and working", () => {
    expect(channelState("sms", setupOf({ policy: null }))).toEqual({
      label: "Setup incomplete",
      tone: "warning",
    });
    expect(channelState("sms", setupOf())).toEqual({ label: "Ready", tone: "success" });
  });

  it("never offers a channel that does not exist yet", () => {
    expect(channelState("whatsapp", setupOf())).toEqual({
      label: "Not available",
      tone: "neutral",
    });
    expect(channelChecks("whatsapp", setupOf())).toEqual([]);
  });
});

describe("channelSummary", () => {
  it("distinguishes code delivery from permission to create an account", () => {
    const off = setupOf({
      settings: { ...setupOf().settings, email: { enabled: true, allowSignUp: false } },
    });
    expect(channelSummary("email", off)).toContain("is still sent an email code and is refused");
    expect(channelSummary("email", setupOf())).toContain("gets one when the code verifies");
  });

  it("says a channel is off rather than listing what would be wrong with it", () => {
    const setup = setupOf({
      policy: null,
      settings: { ...setupOf().settings, sms: { enabled: false, allowSignUp: true } },
    });
    expect(channelSummary("sms", setup)).toContain("is off");
    expect(channelSummary("sms", setup)).not.toContain("blocking");
  });

  it("counts what is blocking on a channel somebody has switched on", () => {
    expect(channelSummary("sms", setupOf({ policy: null }))).toContain("blocking delivery");
  });
});

describe("channelFacts", () => {
  it("leads with what a user feels, in the same four slots on every channel", () => {
    const body = measureSms(renderPreview(TEMPLATES.smsOtpBody, "Acme"));
    for (const id of ["email", "sms", "link"] as const) {
      expect(channelFacts(id, body)).toHaveLength(4);
    }
  });

  it("prices an SMS by segment and warns once a code needs two", () => {
    const one = channelFacts("sms", measureSms("482913 is your Acme code."));
    expect(one[3]?.value).toBe("1");
    expect(one[3]?.tone).toBe("ink");

    const two = channelFacts("sms", measureSms("x".repeat(200)));
    expect(two[3]?.value).toBe("2");
    expect(two[3]?.tone).toBe("warning");
  });
});

describe("channelJourney", () => {
  it("ends on what happens to an address nobody has an account for", () => {
    const settings = setupOf().settings;
    expect(channelJourney("email", settings).at(-1)).toContain("gets one, already verified");

    const off = { ...settings, email: { enabled: true, allowSignUp: false } };
    expect(channelJourney("email", off).at(-1)).toContain("refusal after a perfectly valid code");
  });

  it("puts the exchange on the customer's own route for a link", () => {
    expect(channelJourney("link", setupOf().settings).at(-1)).toContain(
      "Your route calls exchange",
    );
  });
});
