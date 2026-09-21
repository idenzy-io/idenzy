import type { Channel } from "@idenzy/protocol/enums/delivery";

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly from: string;
}

export interface SuppressionList {
  assertSendable(projectId: string, target: string): Promise<void>;
}

export interface UsageMeter {
  assertWithinQuota(projectId: string, channel: Channel): Promise<void>;
  record(
    projectId: string,
    channel: Channel,
    meta: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

/**
 * Port for outbound email (PROJECT.md 11.1).
 *
 * The base owns what must never be skipped: the suppression check, the quota check and
 * the usage record. A subclass supplies transport only, so a new provider cannot forget
 * to check whether an address hard-bounced last week, which is how sending reputation
 * gets destroyed.
 *
 * Declared here in the domain and implemented in providers-email, which is the inversion
 * that keeps the package graph acyclic (PROJECT.md 8.3).
 */
export abstract class EmailProvider {
  protected constructor(
    protected readonly suppression: SuppressionList,
    protected readonly meter: UsageMeter,
  ) {}

  abstract readonly id: string;

  /**
   * Transport only, and it is handed the project because the provider has to stamp it on
   * the message.
   *
   * A delivery event comes back hours later over a channel that knows nothing about the
   * request that sent it, so whatever the transport writes into the message is the only
   * tenant key its bounce will ever carry. The shared sender cannot be resolved back to a
   * project from the address, and nothing stores a message-id mapping.
   */
  protected abstract dispatch(projectId: string, message: OutboundEmail): Promise<string>;

  /** Template method: the guarantees are inherited, the transport is not. */
  async send(projectId: string, message: OutboundEmail): Promise<string> {
    await this.suppression.assertSendable(projectId, message.to);
    await this.meter.assertWithinQuota(projectId, "email");
    const messageId = await this.dispatch(projectId, message);
    await this.meter.record(projectId, "email", { provider: this.id, messageId });
    return messageId;
  }
}
