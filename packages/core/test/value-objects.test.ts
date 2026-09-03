import { describe, expect, it } from "vitest";
import { ValidationFailedError } from "../src/errors.js";
import { E164PhoneNumber } from "../src/value-objects/e164-phone-number.js";
import { EmailAddress } from "../src/value-objects/email-address.js";
import { PublicId } from "../src/value-objects/public-id.js";

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

describe("PublicId", () => {
  const uuid = "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6e";

  it("round-trips a uuid through its public form", () => {
    const encoded = PublicId.encode("usr", uuid);
    expect(encoded.value).toBe("usr_0191f3c29a4d7b218c3e1f2a3b4c5d6e");
    expect(PublicId.parse("usr", encoded.value).uuid).toBe(uuid);
  });

  // The prefix is part of the identity: a session id must not address a user row.
  it("rejects a well-formed id carrying another prefix", () => {
    const session = PublicId.encode("ses", uuid).value;
    expect(() => PublicId.parse("usr", session)).toThrow(ValidationFailedError);
  });

  it.each(["usr_", "usr_notchex", "0191f3c29a4d7b218c3e1f2a3b4c5d6e", ""])(
    "rejects %j",
    (input) => {
      expect(() => PublicId.parse("usr", input)).toThrow(ValidationFailedError);
    },
  );

  it("rejects anything that is not a uuid on the way in", () => {
    expect(() => PublicId.encode("usr", "0191f3c29a4d7b218c3e1f2a3b4c5d6e")).toThrow(
      ValidationFailedError,
    );
  });
});
