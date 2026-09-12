import { createHmac } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import {
  WEBHOOK_SIGNATURE_SCHEME,
  webhookSignatureHeader,
  webhookSignedPayload,
} from "@idenzy/protocol/schemas/webhooks";

/**
 * How a delivery is signed (PROJECT.md 7.2, ADR-0012).
 *
 * A family with one member, and an abstract base anyway, for the reason PROJECT.md 7.2 names
 * webhook signers as one: the scheme is on the wire in front of every digest, which is a promise
 * that a second one can be added beside the first. When that happens — an Ed25519 signature is the
 * usual next ask, because it lets a receiver verify without holding a secret that could also
 * forge — the invariant half must not be reimplemented alongside it. So what a signature *covers*
 * and how several of them are joined into one header live here, and only the primitive varies.
 *
 * Signing a delivery is cheap and worth saying once: an HMAC-SHA256 over a kilobyte is a couple of
 * microseconds, so the whole of a month at 100M deliveries is a few CPU-minutes. Delivery cost is
 * network wait, which is why the pipeline scales with concurrency and not with cores.
 */
export abstract class WebhookSigner {
  /** The name in front of the digest on the wire. */
  abstract readonly scheme: string;

  /**
   * The header value for every secret in force, newest first.
   *
   * Several, because a rotation has two secrets signing every delivery for a day (ADR-0012): a
   * customer redeploys their verifier inside that window and neither secret's deliveries fail. The
   * order is the caller's and is preserved, so "newest first" is a fact about the header rather
   * than a convention a reader has to trust.
   */
  sign(secrets: readonly string[], timestamp: number, rawBody: string): string {
    if (secrets.length === 0) {
      // An unsigned delivery must never go out: a receiver following our own documentation
      // refuses it, so this would be a delivery that looks sent and can never be accepted.
      throw new InternalError({ detail: { reason: "no signing secret in force" } });
    }
    if (!Number.isInteger(timestamp)) {
      throw new InternalError({ detail: { reason: "timestamp must be whole seconds" } });
    }
    const payload = webhookSignedPayload(timestamp, rawBody);
    return webhookSignatureHeader(
      secrets.map((secret) => this.digest(secret, payload)),
      this.scheme,
    );
  }

  /** One digest, lowercase hex. The only part a scheme changes. */
  protected abstract digest(secret: string, payload: string): string;
}

/** The scheme every delivery carries today: HMAC-SHA256, hex, over `${timestamp}.${body}`. */
export class Sha256WebhookSigner extends WebhookSigner {
  readonly scheme = WEBHOOK_SIGNATURE_SCHEME;

  protected digest(secret: string, payload: string): string {
    return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  }
}
