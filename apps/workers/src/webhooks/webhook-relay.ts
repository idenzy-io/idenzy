import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  AuditEventReader,
  OutboxEvent,
} from "@idenzy/persistence/repository/audit-event-reader";
import type { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";
import {
  WebhookDeliveryRepository,
  type WebhookDeliveryRow,
} from "@idenzy/persistence/repository/webhook-delivery-repository";
import { WebhookRepository } from "@idenzy/persistence/repository/webhook-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { projectWebhookData } from "./webhook-data.js";
import type { WebhookDispatcher } from "./webhook-dispatcher.js";
import { WEBHOOK_EVENT_BY_TOPIC, WEBHOOK_TOPICS } from "./webhook-events.js";

/** The consumer name each topic's watermark is stored under. */
export function webhookConsumerFor(topic: string): string {
  return `webhook-fanout:${topic}`;
}

export interface WebhookRelayOptions {
  readonly intervalMs?: number;
  /** How far back a topic with no watermark starts. A day, like the audit relay's. */
  readonly coldStartLookbackMs?: number;
  /**
   * How many first attempts are in flight at once, across every project.
   *
   * The pool is the whole reason the inline lane has a short timeout: a slot held by a slow endpoint
   * is a slot no other customer's delivery can use. Sixteen against a five-second ceiling means one
   * unresponsive receiver costs at most a five-second share of the pool, and everything else falls
   * into the retry lane where it has a slot of its own.
   */
  readonly concurrency?: number;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_COLD_START_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 16;

/**
 * Turns events into deliveries, and makes the first attempt at each (ADR-0012).
 *
 * One watermark per topic rather than one for the relay, because `outbox.seq` is global and a shared
 * bound would be wrong the moment two topics moved at different rates: a sweep that consumed a
 * capped batch of one topic up to sequence 100 while another reached 200 would, on a single
 * watermark, skip everything the first topic had between them. Per topic, each advances over exactly
 * what it consumed.
 *
 * Fan-out is per project and inside the project's own tenant scope. That is what keeps this relay
 * free of a cross-tenant read: an outbox row names its project, so there is nothing here that needs
 * to see every customer's endpoints at once, and the only SECURITY DEFINER function involved is the
 * one the audit relay already uses to read the outbox itself.
 *
 * The first attempt is inline because the batch is already in hand (ADR-0012): handing it to a queue
 * to hand back would cost a task and a request per delivery to arrive at the same HTTP call. What
 * fails here is not retried here — it is due again on the schedule, and the sweeper or a scheduled
 * task picks it up.
 */
export class WebhookRelay {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly events: AuditEventReader,
    private readonly offsets: RelayOffsetRepository,
    private readonly uow: UnitOfWork,
    private readonly dispatcher: WebhookDispatcher,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: WebhookRelayOptions = {},
  ) {}

  /** Sweeps once, awaited, then on a timer — so a broken deployment fails while somebody watches. */
  async start(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every topic. Answers how many deliveries it created. */
  async sweep(): Promise<number> {
    let created = 0;
    for (const topic of WEBHOOK_TOPICS) {
      created += await this.sweepTopic(topic);
    }
    return created;
  }

  private async sweepTopic(topic: string): Promise<number> {
    const consumer = webhookConsumerFor(topic);
    const stored = await this.offsets.read(consumer);
    const since = stored ?? (await this.events.outboxSeqBefore(topic, this.coldStartAt()));
    const pending = await this.events.outboxSince(
      topic,
      since,
      stored === null ? this.coldStartAt() : null,
    );
    if (pending.length === 0) return 0;

    const deliveries: { projectId: string; row: WebhookDeliveryRow }[] = [];
    let watermark = since;
    let consumed = 0;

    for (const event of pending) {
      try {
        const written = await this.fanOut(event);
        for (const row of written) deliveries.push({ projectId: event.projectId, row });
        watermark = event.seq;
        consumed += 1;
      } catch (error: unknown) {
        // Stop at the first failure rather than stepping over it. The watermark stays where the
        // successful part ended, so the next pass resumes from the event that failed instead of
        // leaving a project's events permanently unsent.
        this.logger.error("webhook relay could not fan out", {
          component: "webhook-relay",
          outcome: "failed",
          projectId: event.projectId,
          event: topic,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
        break;
      }
    }

    // Consumed rather than delivered: a pass that found only events whose deliveries already
    // existed — a replay, which is the normal failure — still has to move past them, or a cold
    // start re-reads the same window for ever.
    if (consumed > 0) await this.offsets.advance(consumer, watermark);

    await this.attemptAll(deliveries);
    return deliveries.length;
  }

  /**
   * Writes one delivery per subscribed endpoint, in the project's own scope.
   *
   * The event's `sequence` goes on every delivery, which is what makes a replayed outbox row land on
   * the rows it already wrote rather than sending them again (the unique index does the work).
   */
  private async fanOut(event: OutboxEvent): Promise<WebhookDeliveryRow[]> {
    const type = WEBHOOK_EVENT_BY_TOPIC[event.topic];
    if (type === undefined) return [];
    const tenant = new TenantContext(event.projectId, "webhook-relay", "system");

    return await this.uow.run(tenant, async (tx) => {
      const endpoints = await new WebhookRepository(tx, tenant).enabledFor(type);
      if (endpoints.length === 0) return [];
      // Projected once, here, rather than at send time: the row holds what a customer will see, so
      // every attempt signs the same bytes, and what leaves is a declared shape rather than whatever
      // the internal payload happens to carry.
      const data = projectWebhookData(type, event.payload);
      return await new WebhookDeliveryRepository(tx, tenant).fanOut(
        endpoints.map((endpoint) => ({
          webhookId: endpoint.id,
          event: type,
          sequence: event.seq,
          payload: data,
          // The outbox row's instant, not this pass's. A relay an hour behind must not report an
          // hour-old sign-in as having just happened.
          occurredAt: event.createdAt,
        })),
        this.clock.now(),
      );
    });
  }

  /**
   * First attempts, up to the pool's width at a time.
   *
   * A hand-rolled pool rather than `Promise.all` over the batch: a project that subscribed six
   * endpoints to a busy event would otherwise open six sockets per event and a hundred deliveries
   * would open a hundred. The width is the number of endpoints we are prepared to be slow with at
   * once, which is a property of this worker rather than of anybody's traffic.
   */
  private async attemptAll(
    deliveries: readonly { projectId: string; row: WebhookDeliveryRow }[],
  ): Promise<void> {
    const width = this.options.concurrency ?? DEFAULT_CONCURRENCY;
    const queue = [...deliveries];
    const workers = Array.from({ length: Math.min(width, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        await this.attempt(next.projectId, next.row);
      }
    });
    await Promise.all(workers);
  }

  /**
   * Claims and attempts one delivery.
   *
   * Claimed even though this relay wrote it a moment ago, because the sweeper may have got there
   * first: a delivery created just before a sweep is due immediately, and exactly one of the two has
   * to own it. A claim that loses is not an error, it is the other one working.
   */
  private async attempt(projectId: string, row: WebhookDeliveryRow): Promise<void> {
    const tenant = new TenantContext(projectId, "webhook-relay", "system");
    try {
      const claimed = await this.uow.run(tenant, (tx) =>
        new WebhookDeliveryRepository(tx, tenant).claim(row.id, this.clock.now()),
      );
      if (claimed === null) return;
      await this.dispatcher.dispatch(projectId, claimed, "inline");
    } catch (error: unknown) {
      // Swallowed on purpose: the delivery is still on the table with a time on it, so the worst
      // case is the sweeper attempting it a minute later. Letting this reject would take the rest
      // of the pool's batch with it.
      this.logger.error("webhook first attempt failed outright", {
        component: "webhook-relay",
        outcome: "failed",
        projectId,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  private coldStartAt(): Date {
    return new Date(
      this.clock.nowMs() - (this.options.coldStartLookbackMs ?? DEFAULT_COLD_START_MS),
    );
  }
}
