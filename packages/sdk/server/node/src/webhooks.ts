import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureInvalidError } from "@idenzy/core/errors";
import {
  isWebhookTimestampStale,
  parseWebhookSignatureHeader,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookEnvelope,
  webhookEnvelopeSchema,
  webhookSignedPayload,
} from "@idenzy/protocol/schemas/webhooks";
import { header, type RequestHeaders } from "./request.js";

/**
 * Verifying a webhook we sent, which is the one thing a receiver must not write themselves.
 *
 * It ships here because the note on our own webhooks screen found the alternative failing in the
 * usual way: a copyable example whose header format and comparison disagreed, and a
 * `timingSafeEqual` with no length guard, which throws on a malformed header instead of refusing
 * it. Every one of those mistakes fails *open* in the direction that matters — a receiver that
 * cannot verify its own deliveries tends to stop verifying — so the verifier is a tested function
 * a customer calls rather than a snippet they adapt.
 *
 * Three checks, in this order, and the order is the security property:
 *
 * 1. the timestamp is inside the tolerance, so a captured delivery is not a credential forever;
 * 2. the signed string is rebuilt from the **raw** body, not a re-serialisation of a parsed one;
 * 3. the digest is compared in constant time against every signature in the header, because a
 *    rotation has two secrets in force for a day and either may be the one that signed.
 */

/** What a verified delivery hands back: the envelope, and the delivery id to dedupe on. */
export interface VerifiedWebhook {
  readonly envelope: WebhookEnvelope;
  /**
   * Stable across every attempt of the same delivery.
   *
   * Delivery is at-least-once: a crash between our HTTP call and our own bookkeeping sends the
   * same delivery again, so a receiver that must act once acts on first sight of this id and
   * ignores it afterwards.
   */
  readonly deliveryId: string;
}

export interface VerifyWebhookOptions {
  /**
   * The body exactly as received, before any JSON parsing.
   *
   * A string or the buffer the framework gave you. `JSON.stringify(req.body)` is a different
   * string — whitespace, key order and number formatting all move — and verifying against it
   * fails for reasons nobody can see in a log.
   */
  readonly rawBody: string | Uint8Array;
  readonly headers: RequestHeaders;
  /**
   * The signing secrets to accept, newest first.
   *
   * Plural because a rotation overlaps: during the window both the new and the old secret sign
   * every delivery, so a receiver that holds both verifies throughout and can drop the old one
   * afterwards without a failed delivery in between.
   */
  readonly secrets: readonly string[];
  /** For tests, and for a receiver whose clock it wants to state explicitly. */
  readonly now?: Date;
}

/**
 * Verifies a delivery, or throws.
 *
 * Throws rather than returning false, because the two failure kinds a receiver must not confuse —
 * a delivery that is not ours and a delivery that is too old — both end the same way: answer 400
 * and do nothing. A boolean invites the `if (!ok) {}` that quietly accepts everything.
 */
export function verifyWebhook(options: VerifyWebhookOptions): VerifiedWebhook {
  const body =
    typeof options.rawBody === "string"
      ? options.rawBody
      : Buffer.from(options.rawBody).toString("utf8");
  const timestamp = Number(headerOf(options.headers, WEBHOOK_TIMESTAMP_HEADER));
  const now = (options.now ?? new Date()).getTime() / 1000;

  // First, because it is the cheap check and the one that makes a captured request expire.
  if (isWebhookTimestampStale(timestamp, now)) {
    throw new WebhookSignatureInvalidError({ detail: { reason: "timestamp outside tolerance" } });
  }

  const offered = parseWebhookSignatureHeader(headerOf(options.headers, WEBHOOK_SIGNATURE_HEADER));
  if (offered.length === 0) {
    throw new WebhookSignatureInvalidError({ detail: { reason: "no usable signature" } });
  }

  const payload = webhookSignedPayload(timestamp, body);
  const accepted = options.secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(payload, "utf8").digest();
    // Every offered signature is compared even after one matches: a loop that returned early
    // would leak, in its own duration, how far down the header the match was.
    return offered.reduce((matched, hex) => equals(expected, hex) || matched, false);
  });
  if (!accepted) {
    throw new WebhookSignatureInvalidError({ detail: { reason: "no signature matched" } });
  }

  const parsed = webhookEnvelopeSchema.safeParse(readJson(body));
  if (!parsed.success) {
    throw new WebhookSignatureInvalidError({ detail: { reason: "body is not an event envelope" } });
  }
  return {
    envelope: parsed.data,
    // The header and the envelope carry the same id, and the signed body is the one we trust.
    deliveryId: parsed.data.id,
  };
}

/** Constant time, and length-checked first: `timingSafeEqual` throws on a length mismatch. */
function equals(expected: Buffer, offeredHex: string): boolean {
  const offered = Buffer.from(offeredHex, "hex");
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

function headerOf(headers: RequestHeaders, name: string): string {
  return header(headers, name) ?? "";
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The delivery id as the header carries it, for a receiver deduping before it parses a body. */
export function webhookDeliveryId(headers: RequestHeaders): string | null {
  const value = headerOf(headers, WEBHOOK_DELIVERY_HEADER);
  return value === "" ? null : value;
}
