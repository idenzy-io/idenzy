import { describe, expect, it } from "vitest";
import { ValidationFailedError } from "../src/errors/errors.js";
import { E164PhoneNumber } from "../src/value-objects/e164-phone-number.js";
import { EmailAddress } from "../src/value-objects/email-address.js";

describe("EmailAddress", () => {
  it("normalizes case and surrounding space", () => {
    expect(EmailAddress.parse("  Hasan@Example.COM ").value).toBe("hasan@example.com");
  });

  it("exposes the domain", () => {
    expect(EmailAddress.parse("a@b.example.com").domain).toBe("b.example.com");
  });

  it.each(["", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", `${"x".repeat(321)}@y.com`])(
    "rejects %j",
    (input) => {
      expect(() => EmailAddress.parse(input)).toThrow(ValidationFailedError);
    },
  );
});

describe("E164PhoneNumber", () => {
  it("strips formatting a human would type", () => {
    expect(E164PhoneNumber.parse("+1 (415) 555-0123").value).toBe("+14155550123");
  });

  it.each(["14155550123", "+0155550123", "+1", "+1415555012345678", "phone"])(
    "rejects %j",
    (input) => {
      expect(() => E164PhoneNumber.parse(input)).toThrow(ValidationFailedError);
    },
  );
});
