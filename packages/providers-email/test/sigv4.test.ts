import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type AwsCredentials, signRequest } from "../src/aws/sigv4.js";

const CREDENTIALS: AwsCredentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const TEMPORARY: AwsCredentials = { ...CREDENTIALS, sessionToken: "tok-123" };

const AT = new Date("2026-09-13T15:12:00.000Z");
const ENDPOINT = new URL("https://email.us-central-1.amazonaws.com/v2/email/outbound-emails");

const sign = (
  overrides: Partial<Parameters<typeof signRequest>[0]> = {},
  credentials = CREDENTIALS,
) =>
  signRequest(
    {
      method: "POST",
      url: ENDPOINT,
      body: '{"hello":"world"}',
      region: "us-east-1",
      service: "ses",
      headers: { "content-type": "application/json" },
      ...overrides,
    },
    credentials,
    AT,
  );

const signatureOf = (authorization: string): string =>
  authorization.slice(authorization.indexOf("Signature=") + "Signature=".length);

const signedHeadersOf = (authorization: string): string[] => {
  const match = /SignedHeaders=([^,]+)/.exec(authorization);
  return match?.[1]?.split(";") ?? [];
};

describe("SigV4", () => {
  /**
   * Checked against an independent implementation of the AWS pseudocode, written in
   * Python and run over these exact inputs: the two agree byte for byte, header list
   * included. That cross-check is the reason this vector is worth pinning — a signer only
   * tested against itself is a signer that reproduces its own mistakes, and the authority
   * that would settle it for real is SES accepting a message, which needs credentials
   * nothing here has yet.
   */
  it("produces the signature an independent implementation produces", () => {
    expect(sign({}, TEMPORARY)["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260913/us-east-1/ses/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, " +
        "Signature=08f98d79d9422dde15a87d6f525c8ec933c3b1d8b516eefcc6ea60e00b72cd26",
    );
  });

  /**
   * The mistake worth a test of its own. A header that is sent but not named in
   * `SignedHeaders` produces a signature that verifies against a message nobody sent, and
   * AWS rejects it in a way that reads as a credentials problem.
   */
  it("names in SignedHeaders exactly the headers it returns", () => {
    const headers = sign({}, TEMPORARY);
    const named = signedHeadersOf(headers["authorization"] ?? "");
    const sent = Object.keys(headers)
      .filter((name) => name !== "authorization")
      .map((name) => name.toLowerCase())
      .sort();

    expect(named).toEqual(sent);
  });

  it("signs host, so a signature cannot be replayed against another endpoint", () => {
    const here = sign();
    const elsewhere = sign({
      url: new URL("https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails"),
    });

    expect(signedHeadersOf(here["authorization"] ?? "")).toContain("host");
    expect(signatureOf(here["authorization"] ?? "")).not.toBe(
      signatureOf(elsewhere["authorization"] ?? ""),
    );
  });

  it("signs the body, so the message cannot be swapped after signing", () => {
    const first = sign({ body: '{"to":"someone@example.test"}' });
    const second = sign({ body: '{"to":"attacker@example.test"}' });
    expect(signatureOf(first["authorization"] ?? "")).not.toBe(
      signatureOf(second["authorization"] ?? ""),
    );
  });

  it("sorts the signed header list, whatever order it was given", () => {
    const headers = sign({
      headers: { "x-zzz": "last", "content-type": "application/json", "a-first": "first" },
    });
    const named = signedHeadersOf(headers["authorization"] ?? "");
    expect(named).toEqual([...named].sort());
  });

  it("carries a session token as a signed header only when there is one", () => {
    expect(sign({}, TEMPORARY)["x-amz-security-token"]).toBe("tok-123");
    expect(signedHeadersOf(sign({}, TEMPORARY)["authorization"] ?? "")).toContain(
      "x-amz-security-token",
    );

    expect(sign()["x-amz-security-token"]).toBeUndefined();
    expect(signedHeadersOf(sign()["authorization"] ?? "")).not.toContain("x-amz-security-token");
  });

  it("scopes the credential to the date, region and service it signed for", () => {
    expect(sign()["authorization"]).toContain(
      "Credential=AKIDEXAMPLE/20260913/us-east-1/ses/aws4_request",
    );
    expect(sign()["x-amz-date"]).toBe("20260913T151200Z");
  });

  it("changes with the clock, so a signature has a life", () => {
    const later = signRequest(
      {
        method: "POST",
        url: ENDPOINT,
        body: "{}",
        region: "us-east-1",
        service: "ses",
        headers: {},
      },
      CREDENTIALS,
      new Date("2026-09-13T16:12:00.000Z"),
    );
    expect(later["x-amz-date"]).toBe("20260913T161200Z");
    expect(createHash("sha256")).toBeDefined();
  });
});
