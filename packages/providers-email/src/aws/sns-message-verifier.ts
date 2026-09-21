import { createVerify } from "node:crypto";
import { ProviderUnavailableError, ValidationFailedError } from "@idenzy/core/errors";
import { z } from "zod";

/**
 * The SNS envelope, before any of it is believed.
 *
 * `SigningCertURL` is a string here rather than a URL, because where it points is a check
 * this class makes and not one the schema can express.
 */
const envelopeSchema = z.object({
  Type: z.enum(["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string().min(1),
  Signature: z.string().min(1),
  SignatureVersion: z.enum(["1", "2"]),
  SigningCertURL: z.string().min(1),
  Subject: z.string().optional(),
  Token: z.string().optional(),
  SubscribeURL: z.string().optional(),
});

export type SnsEnvelope = z.infer<typeof envelopeSchema>;

/**
 * The fields that go into the signature, in order, per message type.
 *
 * Order and membership are both part of the signature, so these are not two spellings of
 * one list: signing a `SubscriptionConfirmation` as if it were a `Notification` produces a
 * string that verifies against nothing.
 */
const SIGNED_FIELDS = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
  UnsubscribeConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
} as const satisfies Record<SnsEnvelope["Type"], readonly string[]>;

/** SNS signs with SHA1 by default and SHA256 where a topic has opted in. */
const DIGESTS = { "1": "RSA-SHA1", "2": "RSA-SHA256" } as const;

/**
 * Only AWS publishes a certificate we will fetch.
 *
 * The one check that cannot be skipped. A signature is worth exactly as much as the key it
 * was checked against, so a `SigningCertURL` taken at face value turns verification into
 * "fetch a key from whoever sent this and confirm they signed their own message", which
 * every forgery passes. Anchored at both ends, because `sns.eu-west-1.amazonaws.com.evil.test`
 * contains the host we wanted.
 */
const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

const DEFAULT_TIMEOUT_MS = 5_000;

export interface SnsVerifierOptions {
  /**
   * The topic ARNs this receiver accepts, and it is not optional.
   *
   * A valid signature proves the message came from *an* SNS topic, not from ours. Anyone
   * can create a topic, subscribe our URL to it and publish whatever they like through it,
   * and every one of those messages carries a genuine AWS signature. The ARN is the check
   * that makes the signature mean something.
   */
  readonly topicArns: readonly string[];
  readonly timeoutMs?: number;
}

/**
 * Verifies that an SNS message is from AWS, and from a topic we asked to hear from.
 *
 * Certificates are cached by URL for the process's life: SNS rotates them rarely, the URL
 * changes when it does, and a fetch per notification would put an outbound call on the path
 * of every bounce we receive.
 */
export class SnsMessageVerifier {
  private readonly certificates = new Map<string, string>();

  constructor(private readonly options: SnsVerifierOptions) {}

  /**
   * Parses, checks the topic, then checks the signature.
   *
   * The topic first because it is free and settles the case this exists for; fetching a
   * certificate to verify a message we were going to refuse anyway is an outbound request
   * a stranger gets to trigger.
   */
  async verify(body: string): Promise<SnsEnvelope> {
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch (cause) {
      throw new ValidationFailedError({
        detail: { reason: "the SNS body is not JSON" },
        cause,
      });
    }

    const envelope = envelopeSchema.parse(raw);

    if (!this.options.topicArns.includes(envelope.TopicArn)) {
      throw new ValidationFailedError({
        detail: { reason: "the message names a topic this receiver does not subscribe to" },
      });
    }

    const certificate = await this.certificateFor(envelope.SigningCertURL);
    const verifier = createVerify(DIGESTS[envelope.SignatureVersion]);
    verifier.update(canonical(envelope), "utf8");

    if (!verifier.verify(certificate, envelope.Signature, "base64")) {
      throw new ValidationFailedError({
        detail: { reason: "the SNS signature does not verify against the signing certificate" },
      });
    }

    return envelope;
  }

  private async certificateFor(url: string): Promise<string> {
    const cached = this.certificates.get(url);
    if (cached !== undefined) return cached;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (cause) {
      throw new ValidationFailedError({
        detail: { reason: "the signing certificate URL is not a URL" },
        cause,
      });
    }
    if (parsed.protocol !== "https:" || !CERT_HOST.test(parsed.hostname)) {
      throw new ValidationFailedError({
        detail: {
          reason: "the signing certificate is not published by SNS",
          host: parsed.hostname,
        },
      });
    }

    const response = await fetch(parsed, {
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ProviderUnavailableError({
        detail: { reason: "the signing certificate could not be fetched", status: response.status },
      });
    }

    const certificate = await response.text();
    this.certificates.set(url, certificate);
    return certificate;
  }
}

/**
 * Confirms a subscription by following `SubscribeURL`.
 *
 * Separate from the verifier because confirming is an action and verifying is a judgement,
 * and the caller must have made the judgement first. Confirming an unverified message
 * subscribes us to a stranger's topic, after which every message they publish arrives
 * carrying a real AWS signature.
 */
export class SnsSubscriptionConfirmer {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async confirm(envelope: SnsEnvelope): Promise<void> {
    const target = envelope.SubscribeURL;
    if (target === undefined) {
      throw new ValidationFailedError({
        detail: { reason: "a subscription confirmation carried no SubscribeURL" },
      });
    }
    const response = await fetch(target, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new ProviderUnavailableError({
        detail: { reason: "the subscription could not be confirmed", status: response.status },
      });
    }
  }
}

/**
 * The string AWS signed: each present field as `name\nvalue\n`, in the order for its type.
 *
 * An absent optional field is omitted entirely rather than sent as an empty value, which is
 * why `Subject` is in the `Notification` list and still does not always appear.
 */
function canonical(envelope: SnsEnvelope): string {
  const fields = SIGNED_FIELDS[envelope.Type];
  // The field names are string literals from SIGNED_FIELDS, so the compiler cannot relate
  // them to the envelope's keys without a lookup type that would have to be kept in step by
  // hand. Every signed field is a string or absent, which is what this narrows to.
  const record = envelope as unknown as Readonly<Record<string, string | undefined>>;
  let signed = "";
  for (const field of fields) {
    const value = record[field];
    if (value === undefined) continue;
    signed += `${field}\n${value}\n`;
  }
  return signed;
}
