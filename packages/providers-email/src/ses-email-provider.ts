import { DeliveryFailedError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import {
  EmailProvider,
  type OutboundEmail,
  type SuppressionList,
  type UsageMeter,
} from "@idenzy/domain/ports/email-provider";
import { type AwsCredentialsProvider, signRequest } from "./aws/sigv4.js";

export interface SesOptions {
  readonly region: string;
  readonly credentials: AwsCredentialsProvider;
  /**
   * The configuration set every message is sent through.
   *
   * Not optional, and that is the point of it. Bounces and complaints reach us only
   * because a configuration set publishes them to SNS, and a message sent outside one is
   * a message whose bounce we never hear about — which is how an address that hard-bounced
   * keeps being written to and takes the shared domain's reputation with it (PROJECT.md
   * 4.7). Requiring it here means a misconfigured deployment cannot send at all rather than
   * send with the feedback loop quietly disconnected.
   */
  readonly configurationSet: string;
  /** How long one send may take before it is abandoned. */
  readonly timeoutMs?: number;
}

interface SesSuccess {
  readonly MessageId?: string;
}

interface SesFailure {
  readonly message?: string;
  readonly Message?: string;
  readonly __type?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Amazon SES v2, over `fetch` and a hand-written SigV4 (PROJECT.md 11.1, 7.6).
 *
 * The transport and nothing else: suppression, quota and metering are the base class's and
 * are deliberately not touched here, because overriding `send` to add a header is exactly
 * how an adapter ends up mailing an address that hard-bounced in March
 * (`EmailProviderConformanceSuite`).
 *
 * `@aws-sdk/client-sesv2` is not a dependency. Our entire use of it is one POST with a JSON
 * body, and the dependency budget in 7.6 exists precisely for calls of that shape — the
 * client package and its tree would be a supply-chain surface (4.1, threat 10) far wider
 * than the feature.
 */
export class SesEmailProvider extends EmailProvider {
  override readonly id = "ses";

  private readonly endpoint: URL;

  constructor(
    suppression: SuppressionList,
    meter: UsageMeter,
    private readonly clock: Clock,
    private readonly options: SesOptions,
  ) {
    super(suppression, meter);
    this.endpoint = new URL(
      `https://email.${options.region}.amazonaws.com/v2/email/outbound-emails`,
    );
  }

  protected override async dispatch(message: OutboundEmail): Promise<string> {
    const body = JSON.stringify({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      ConfigurationSetName: this.options.configurationSet,
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: message.html, Charset: "UTF-8" },
            Text: { Data: message.text, Charset: "UTF-8" },
          },
        },
      },
    });

    const credentials = await this.options.credentials();
    const headers = signRequest(
      {
        method: "POST",
        url: this.endpoint,
        body,
        region: this.options.region,
        service: "ses",
        headers: { "content-type": "application/json" },
      },
      credentials,
      this.clock.now(),
    );

    const response = await this.post(body, headers);

    if (!response.ok) {
      // The upstream text goes in `detail` and never into the public message: an SES
      // error names our own account, identities and quotas.
      throw new DeliveryFailedError({
        detail: {
          provider: this.id,
          status: response.status,
          reason: this.reasonFrom(response.text),
        },
      });
    }

    const parsed = this.parse<SesSuccess>(response.text);
    const messageId = parsed?.MessageId;
    if (messageId === undefined || messageId.length === 0) {
      // A 200 with no id is not a success we can record. The base is about to meter this
      // send against the customer's bill and hand the id back as the receipt for it.
      throw new DeliveryFailedError({
        detail: { provider: this.id, reason: "SES accepted the message without returning an id" },
      });
    }
    return messageId;
  }

  private async post(
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ readonly ok: boolean; readonly status: number; readonly text: string }> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { ...headers },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    } catch (cause) {
      // A timeout or a socket failure is indistinguishable from here: the message may or
      // may not have gone out. It is reported as a failure because the alternative is
      // reporting a success we cannot stand behind, and the caller's retry is a duplicate
      // email rather than a silent absence.
      throw new DeliveryFailedError({
        detail: { provider: this.id, reason: "the request to SES did not complete" },
        cause,
      });
    }
  }

  private reasonFrom(text: string): string {
    const parsed = this.parse<SesFailure>(text);
    return parsed?.message ?? parsed?.Message ?? parsed?.__type ?? "unrecognised SES error";
  }

  private parse<T>(text: string): T | null {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
