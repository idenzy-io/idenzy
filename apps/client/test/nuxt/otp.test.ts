import { describe, expect, it } from "vitest";
import {
  formatMoney,
  humanizeSeconds,
  measureSms,
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
