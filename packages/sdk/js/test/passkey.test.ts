import type { PublicKeyCredentialCreationOptions } from "@idenzy/protocol/schemas/webauthn";
import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../src/passkey/base64url.js";
import { toCreationOptions, toRequestOptions } from "../src/passkey/ceremony-options.js";

const CREATION: PublicKeyCredentialCreationOptions = {
  rp: { id: "acme.test", name: "Acme" },
  user: { id: "dXNyLTE", name: "ada@example.test", displayName: "Ada" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [
    { type: "public-key", alg: -7 },
    { type: "public-key", alg: -257 },
  ],
  authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  excludeCredentials: [{ id: "Y3JlZC0x", type: "public-key", transports: ["hybrid", "internal"] }],
};

/**
 * Back to the encoding the wire uses, for comparison. The conversion only ever produces a
 * `Uint8Array`, which `BufferSource` is too wide to say, and a test asserting on the bytes has
 * to name the narrower type to reach `.buffer`.
 */
function encoded(value: BufferSource | undefined): string {
  return toBase64Url((value as Uint8Array<ArrayBuffer>).buffer);
}

describe("base64url", () => {
  it("survives a round trip over every byte value", () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    expect([...fromBase64Url(toBase64Url(bytes.buffer))]).toEqual([...bytes]);
  });

  it("decodes a value whose length needs padding restored", () => {
    // "abc" is three characters, so base64 padding is missing; browsers disagree about
    // tolerating that, which is how one vendor's users end up unable to sign in.
    expect([...fromBase64Url("abc")]).toEqual([105, 183]);
  });

  it("emits no padding and none of the characters a URL would escape", () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 190]).buffer);
    expect(encoded).toBe("-_--");
  });
});

describe("ceremony options", () => {
  it("hands the browser bytes where the wire had base64url", () => {
    const options = toCreationOptions(CREATION);

    expect(encoded(options.challenge)).toBe("Y2hhbGxlbmdl");
    expect(encoded(options.user.id)).toBe("dXNyLTE");
    expect(encoded(options.excludeCredentials?.[0]?.id)).toBe("Y3JlZC0x");
  });

  /**
   * `residentKey: required` at registration is what pays for a sign-in that takes no
   * identifier. Losing it here would break the usernameless flow for every credential
   * enrolled afterwards, and only for those.
   */
  it("keeps the server's authenticator selection exactly as it was sent", () => {
    expect(toCreationOptions(CREATION).authenticatorSelection).toEqual({
      residentKey: "required",
      userVerification: "preferred",
    });
  });

  it("carries transports through, including a hint this version has never heard of", () => {
    const withUnknown = {
      ...CREATION,
      excludeCredentials: [
        { id: "Y3JlZC0x", type: "public-key" as const, transports: ["tomorrow"] },
      ],
    };

    expect(toCreationOptions(withUnknown).excludeCredentials?.[0]?.transports).toEqual([
      "tomorrow",
    ]);
  });

  it("names no credential when the server offered none, which is the discoverable case", () => {
    const options = toRequestOptions({ challenge: "Y2hhbGxlbmdl", rpId: "acme.test" });

    expect(options.allowCredentials).toBeUndefined();
    expect(options.rpId).toBe("acme.test");
  });
});
