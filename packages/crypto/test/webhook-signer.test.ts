import { createHmac } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import { parseWebhookSignatureHeader } from "@idenzy/protocol/schemas/webhooks";
import { describe, expect, it } from "vitest";
import { Sha256WebhookSigner, WebhookSigner } from "../src/webhooks/webhook-signer.js";

const signer = new Sha256WebhookSigner();
const BODY = '{"id":"whd_1","type":"session.created"}';
const TIMESTAMP = 1_700_000_000;

function expected(secret: string): string {
  return createHmac("sha256", secret).update(`${TIMESTAMP}.${BODY}`, "utf8").digest("hex");
}

describe("Sha256WebhookSigner", () => {
  it("signs the timestamp and the body, which is what a receiver rebuilds", () => {
    const header = signer.sign(["whsec_one"], TIMESTAMP, BODY);
    expect(parseWebhookSignatureHeader(header)).toEqual([expected("whsec_one")]);
  });

  /* A rotation has two secrets in force for a day: both sign, newest first, so a receiver
     redeploying inside the window never sees a failed delivery (ADR-0012). */
  it("signs with every secret in force and keeps the caller's order", () => {
    const header = signer.sign(["whsec_new", "whsec_old"], TIMESTAMP, BODY);
    expect(parseWebhookSignatureHeader(header)).toEqual([
      expected("whsec_new"),
      expected("whsec_old"),
    ]);
  });

  it("changes with the body and with the timestamp, separately", () => {
    const base = signer.sign(["s"], TIMESTAMP, BODY);
    expect(signer.sign(["s"], TIMESTAMP, `${BODY} `)).not.toBe(base);
    expect(signer.sign(["s"], TIMESTAMP + 1, BODY)).not.toBe(base);
  });

  it("names its scheme on the wire, so a second one can be added beside it", () => {
    expect(signer.scheme).toBe("sha256");
    expect(signer.sign(["s"], TIMESTAMP, BODY).startsWith("sha256=")).toBe(true);
  });

  /* An unsigned delivery is worse than an undelivered one: a receiver following our own
     documentation refuses it, so it looks sent and can never be accepted. */
  it("refuses to sign with no secret in force", () => {
    expect(() => signer.sign([], TIMESTAMP, BODY)).toThrow(InternalError);
  });

  it("refuses a timestamp that is not whole seconds, which the header cannot carry", () => {
    expect(() => signer.sign(["s"], TIMESTAMP + 0.5, BODY)).toThrow(InternalError);
    expect(() => signer.sign(["s"], Number.NaN, BODY)).toThrow(InternalError);
  });

  it("handles a body that is not ASCII, because a display name is not", () => {
    const body = '{"name":"Hasan\'ın MacBook\'u — ünlü"}';
    const header = signer.sign(["s"], TIMESTAMP, body);
    const digest = createHmac("sha256", "s").update(`${TIMESTAMP}.${body}`, "utf8").digest("hex");
    expect(parseWebhookSignatureHeader(header)).toEqual([digest]);
  });
});

/**
 * The base class holds what a signature covers and how several are joined; a scheme supplies only
 * the primitive. This is the shape PROJECT.md 7.2 asks for, and the test is what makes it a
 * contract rather than a comment.
 */
describe("the signer family", () => {
  class StubSigner extends WebhookSigner {
    readonly scheme = "stub";
    protected digest(secret: string, payload: string): string {
      return `${secret}:${payload.length}`;
    }
  }

  it("gives a new scheme the joining and the signed string for free", () => {
    const header = new StubSigner().sign(["a", "b"], TIMESTAMP, BODY);
    expect(header).toBe(
      `stub=a:${`${TIMESTAMP}.${BODY}`.length}, stub=b:${`${TIMESTAMP}.${BODY}`.length}`,
    );
  });

  it("applies the invariant refusals to every scheme, not only the one that shipped", () => {
    expect(() => new StubSigner().sign([], TIMESTAMP, BODY)).toThrow(InternalError);
  });
});
