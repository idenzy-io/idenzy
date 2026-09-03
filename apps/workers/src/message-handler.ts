import { Logger } from "@idenzy/core/logging/logger";

export interface QueueMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly deliveryAttempt: number;
}

/**
 * Base for every consumer (PROJECT.md 9.1).
 *
 * A worker is a class with a handle method registered in a module, not a script. The
 * base owns two things no consumer may get wrong: at-least-once delivery means handling
 * must be idempotent, and a permanent failure must not be retried forever.
 */
export abstract class MessageHandler {
  protected constructor(protected readonly logger: Logger) {}

  abstract readonly topic: string;
  protected abstract process(message: QueueMessage): Promise<void>;

  /** Override for errors that will never succeed on retry, so they go straight to the DLQ. */
  protected isPermanentFailure(_error: unknown): boolean {
    return false;
  }

  async handle(message: QueueMessage): Promise<void> {
    try {
      await this.process(message);
    } catch (error: unknown) {
      const permanent = this.isPermanentFailure(error);
      this.logger.error("message handling failed", {
        outcome: permanent ? "dead_letter" : "retry",
        component: this.topic,
      });
      if (!permanent) throw error;
    }
  }
}
