import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { suppressionDigest } from "@idenzy/crypto/delivery/suppression-digest";
import {
  type DeliveryCounter,
  EmailDeliveryStatsRepository,
} from "@idenzy/persistence/repository/email-delivery-stats-repository";
import type { EmailProviderEventRepository } from "@idenzy/persistence/repository/email-provider-event-repository";
import { SuppressionRepository } from "@idenzy/persistence/repository/suppression-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel } from "@idenzy/protocol/enums/delivery";
import type {
  SnsMessageVerifier,
  SnsSubscriptionConfirmer,
} from "@idenzy/providers-email/aws/sns-message-verifier";
import {
  SesBounceType,
  type SesEvent,
  SesEventParser,
  SesEventType,
  suppresses,
} from "@idenzy/providers-email/ses-events";

const PROVIDER = "ses";

/**
 * What one message did. None of these is a failure, and the distinction is for the log.
 *
 * `untagged` is the one worth watching: it means a message left without the tag that says who
 * sent it, so its bounce cannot be attributed and the address cannot be suppressed for anyone.
 * It is expected for mail sent before tagging existed and is a real defect for anything after.
 */
export type EmailEventOutcome = "recorded" | "duplicate" | "untagged" | "subscription_confirmed";

/**
 * The receiver PROJECT.md 11.2 item 4 describes: SNS to the suppression list (risks.md 2b).
 *
 * Split from the HTTP server the way `WebhookTaskEndpoint` is, and for the same reason: what a
 * notification *means* is testable against a real database without a socket, and what the
 * server adds is a body limit and a status code.
 *
 * The order is the one `PaymentWebhookService` established and it is not interchangeable.
 * Verify first, so nothing unsigned reaches a write. Record second, because SNS delivers at
 * least once and the unique index is the only thing standing between a redelivered bounce and
 * a rate that reads twice what it should. Act third.
 */
export class EmailEventEndpoint {
  private readonly parser = new SesEventParser();

  constructor(
    private readonly uow: UnitOfWork,
    private readonly events: EmailProviderEventRepository,
    private readonly verifier: SnsMessageVerifier,
    private readonly confirmer: SnsSubscriptionConfirmer,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async run(body: unknown): Promise<EmailEventOutcome> {
    // The server hands over the raw text rather than parsed JSON: the signature covers the
    // envelope's own fields and `Message` is a string inside it, so nothing may be re-encoded
    // on the way here.
    const envelope = await this.verifier.verify(typeof body === "string" ? body : String(body));

    if (envelope.Type !== "Notification") {
      // Confirming and unsubscribing both arrive here. Only a message that has already passed
      // the signature *and* the topic allowlist gets to move a subscription, which is the whole
      // reason confirmation is not done inside the verifier.
      await this.confirmer.confirm(envelope);
      this.logger.info("sns subscription confirmed", {
        component: "email-events",
        outcome: "confirmed",
        messageType: envelope.Type,
      });
      return "subscription_confirmed";
    }

    const event = this.parser.parse(envelope.Message);

    const first = await this.events.record({
      provider: PROVIDER,
      providerEventId: envelope.MessageId,
      type: event.type,
      projectId: event.projectId,
      bounceType: event.bounceType,
      bounceSubType: event.bounceSubType,
    });
    if (!first) {
      this.logger.debug("ses event already seen", {
        component: "email-events",
        outcome: "skipped",
        eventType: event.type,
      });
      return "duplicate";
    }

    try {
      const outcome = await this.apply(event);
      await this.events.markProcessed(PROVIDER, envelope.MessageId);
      return outcome;
    } catch (error) {
      // The row stays unprocessed and carries why. Rethrowing would have SNS redeliver, and a
      // redelivery now collides with the row just written and is dropped as a duplicate — so
      // the retry would be the one thing that cannot work.
      await this.events.markFailed(
        PROVIDER,
        envelope.MessageId,
        error instanceof Error ? error.name : "unknown",
      );
      throw error;
    }
  }

  /** Counts the event, and suppresses the address where the event says to. */
  private async apply(event: SesEvent): Promise<EmailEventOutcome> {
    const projectId = event.projectId;
    if (projectId === null) {
      this.logger.warn("ses event carried no project tag", {
        component: "email-events",
        outcome: "untagged",
        eventType: event.type,
      });
      return "untagged";
    }

    const tenant = new TenantContext(projectId, "email-events", "system");
    const day = this.clock.now().toISOString().slice(0, 10);
    const counter = this.counterFor(event);
    const digests = suppresses(event) ? event.recipients.map(suppressionDigest) : [];
    const reason = this.reasonFor(event);

    await this.uow.transaction(async (tx) => {
      await new EmailDeliveryStatsRepository(tx, tenant).increment(day, counter);
      // One transaction with the counter, so a crash cannot leave a bounce counted and the
      // address still sendable — which is the half of the pair that costs us reputation.
      const suppressions = new SuppressionRepository(tx, tenant);
      for (const digest of digests) {
        await suppressions.suppress(Channel.Email, digest, reason);
      }
    });

    return "recorded";
  }

  /**
   * A permanent bounce and a transient one are different columns and the same event type.
   *
   * Both count — AWS counts both towards the account's rate — and only the permanent one
   * suppresses, so the split has to live somewhere and the counter is where it is visible.
   */
  private counterFor(event: SesEvent): DeliveryCounter {
    switch (event.type) {
      case SesEventType.Send:
        return "sent";
      case SesEventType.Delivery:
        return "delivered";
      case SesEventType.Complaint:
        return "complained";
      case SesEventType.Reject:
        return "rejected";
      case SesEventType.Bounce:
        return event.bounceType === SesBounceType.Permanent ? "bouncedHard" : "bouncedSoft";
    }
  }

  private reasonFor(event: SesEvent): string {
    if (event.type === SesEventType.Complaint) return "complaint";
    return event.bounceSubType === null ? "hard_bounce" : `hard_bounce:${event.bounceSubType}`;
  }
}
