import { createHmac } from "node:crypto";
import { WebhookSignatureInvalidError } from "@idenzy/core/errors";
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@idenzy/protocol/schemas/webhooks";
import { describe, expect, it } from "vitest";
import { verifyWebhook, webhookDeliveryId } from "../src/webhooks.js";

const SECRET = "whsec_9f2c41a83e7b4d0e";
const NOW = new Date("2026-09-13T10:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

const ENVELOPE = {
  id: "whd_7d2f",
  type: "session.created",
  sequence: 4821,
  createdAt: "2026-09-13T09:59:58.000Z",
  project: "prj_acme",
  data: { sessionId: "ses_1", userId: "usr_1" },
};

/** The body as the wire carries it: one serialisation, signed and sent, never re-derived. */
const BODY = JSON.stringify(ENVELOPE);

function signature(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

function headers(change: Record<string, string> = {}): Record<string, string> {
  return {
    [WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: signature(SECRET, TIMESTAMP, BODY),
    [WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: String(TIMESTAMP),
    [WEBHOOK_DELIVERY_HEADER.toLowerCase()]: ENVELOPE.id,
    ...change,
  };
}

describe("verifyWebhook", () => {
  it("verifies a delivery we signed and hands back the envelope", () => {
    const verified = verifyWebhook({
      rawBody: BODY,
      headers: headers(),
      secrets: [SECRET],
      now: NOW,
    });
    expect(verified.envelope.type).toBe("session.created");
    expect(verified.envelope.sequence).toBe(4821);
    expect(verified.deliveryId).toBe("whd_7d2f");
  });

  it("takes the body as bytes, which is what a framework hands a raw-body parser", () => {
    const verified = verifyWebhook({
      rawBody: new TextEncoder().encode(BODY),
      headers: headers(),
      secrets: [SECRET],
      now: NOW,
    });
    expect(verified.deliveryId).toBe("whd_7d2f");
  });

  it("reads headers off a Headers object as well as a record", () => {
    const asHeaders = new Headers(headers());
    const verified = verifyWebhook({
      rawBody: BODY,
      headers: asHeaders,
      secrets: [SECRET],
      now: NOW,
    });
    expect(verified.deliveryId).toBe("whd_7d2f");
  });

  /* The rotation window: both secrets sign, and a receiver holding either verifies. */
  it("accepts any secret in force", () => {
    const signed = {
      [WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: [
        signature("whsec_new", TIMESTAMP, BODY),
        signature("whsec_old", TIMESTAMP, BODY),
      ].join(", "),
      [WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: String(TIMESTAMP),
    };
    for (const secret of ["whsec_new", "whsec_old"]) {
      expect(
        verifyWebhook({ rawBody: BODY, headers: signed, secrets: [secret], now: NOW }).deliveryId,
      ).toBe("whd_7d2f");
    }
  });

  it("refuses a signature from a secret nobody holds", () => {
    expect(() =>
      verifyWebhook({ rawBody: BODY, headers: headers(), secrets: ["whsec_wrong"], now: NOW }),
    ).toThrow(WebhookSignatureInvalidError);
  });

  /* The body is signed, so a changed body is a changed signature. This is the check that makes a
     webhook a statement rather than a suggestion. */
  it("refuses a body that was edited in flight, including by whitespace", () => {
    for (const body of [`${BODY} `, BODY.replace("4821", "4822"), '{"id":"whd_7d2f"}']) {
      expect(() =>
        verifyWebhook({ rawBody: body, headers: headers(), secrets: [SECRET], now: NOW }),
      ).toThrow(WebhookSignatureInvalidError);
    }
  });

  it("refuses a delivery older than the tolerance, which is what replay safety is", () => {
    const old = TIMESTAMP - 301;
    expect(() =>
      verifyWebhook({
        rawBody: BODY,
        headers: {
          [WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: signature(SECRET, old, BODY),
          [WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: String(old),
        },
        secrets: [SECRET],
        now: NOW,
      }),
    ).toThrow(WebhookSignatureInvalidError);
  });

  /* A captured delivery with its timestamp moved forward: the timestamp is inside the signed
     string, so moving it breaks the digest rather than refreshing the delivery. */
  it("refuses a replay whose timestamp was moved to look fresh", () => {
    const captured = signature(SECRET, TIMESTAMP - 3600, BODY);
    expect(() =>
      verifyWebhook({
        rawBody: BODY,
        headers: {
          [WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: captured,
          [WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: String(TIMESTAMP),
        },
        secrets: [SECRET],
        now: NOW,
      }),
    ).toThrow(WebhookSignatureInvalidError);
  });

  /* The note's own acceptance check: the malformed cases must refuse rather than throw something
     a receiver did not expect. `timingSafeEqual` on a short buffer throws a RangeError, which is
     the bug the length guard exists for. */
  it("refuses a malformed signature header rather than failing in an unexpected way", () => {
    for (const value of [
      "",
      "nonsense",
      "sha256=",
      "sha256=deadbeef",
      `sha256=${"z".repeat(64)}`,
      createHmac("sha256", SECRET).update(`${TIMESTAMP}.${BODY}`).digest("hex"),
    ]) {
      expect(
        () =>
          verifyWebhook({
            rawBody: BODY,
            headers: headers({ [WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: value }),
            secrets: [SECRET],
            now: NOW,
          }),
        value,
      ).toThrow(WebhookSignatureInvalidError);
    }
  });

  it("refuses a missing or unreadable timestamp", () => {
    for (const value of ["", "soon", "1.5"]) {
      expect(() =>
        verifyWebhook({
          rawBody: BODY,
          headers: headers({ [WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: value }),
          secrets: [SECRET],
          now: NOW,
        }),
      ).toThrow(WebhookSignatureInvalidError);
    }
  });

  /* A correctly signed body that is not an event is still not something to act on: it would
     reach a receiver's switch statement with nothing in it. */
  it("refuses a signed body that is not an event envelope", () => {
    const body = '{"hello":"world"}';
    expect(() =>
      verifyWebhook({
        rawBody: body,
        headers: {
          [WEBHOOK_SIGNATURE_HEADER.toLowerCase()]: signature(SECRET, TIMESTAMP, body),
          [WEBHOOK_TIMESTAMP_HEADER.toLowerCase()]: String(TIMESTAMP),
        },
        secrets: [SECRET],
        now: NOW,
      }),
    ).toThrow(WebhookSignatureInvalidError);
  });

  it("refuses when no secret is offered at all", () => {
    expect(() =>
      verifyWebhook({ rawBody: BODY, headers: headers(), secrets: [], now: NOW }),
    ).toThrow(WebhookSignatureInvalidError);
  });
});

describe("webhookDeliveryId", () => {
  it("reads the id a receiver dedupes on before it parses a body", () => {
    expect(webhookDeliveryId(headers())).toBe("whd_7d2f");
  });

  it("answers null rather than an empty string when the header is absent", () => {
    expect(webhookDeliveryId({})).toBeNull();
  });
});
