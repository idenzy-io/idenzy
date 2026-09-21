import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import type { WebhookSigner } from "@idenzy/crypto/webhooks/webhook-signer";
import {
  type AttemptOutcome,
  type DeliveryStatus,
  WebhookDeliveryRepository,
  type WebhookDeliveryRow,
} from "@idenzy/persistence/repository/webhook-delivery-repository";
import {
  WebhookRepository,
  type WebhookRow,
} from "@idenzy/persistence/repository/webhook-repository";
import {
  statsDay,
  WebhookStatsRepository,
} from "@idenzy/persistence/repository/webhook-stats-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import {
  buildWebhookEnvelope,
  WEBHOOK_ATTEMPT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_FAILURES_BEFORE_DISABLED,
  WEBHOOK_INLINE_TIMEOUT_MS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_TIMEOUT_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  webhookRetryDelaySeconds,
} from "@idenzy/protocol/schemas/webhooks";
import type { DeliveryScheduler } from "./delivery-scheduler.js";
import type { TransportResult, WebhookTransport } from "./webhook-transport.js";

/**
 * Which lane an attempt is on, which decides only how long it may take.
 *
 * The first attempt shares a bounded pool with every other project's, so a slow endpoint there costs
 * everybody a slot: five seconds, and anything slower becomes a retry. A retry has a slot of its own
 * and gets fifteen (ADR-0012).
 */
export type DeliveryLane = "inline" | "retry";

/** What a dispatch did, for the caller's own logging and for the tests. */
export interface DispatchResult {
  readonly status: DeliveryStatus;
  readonly attempt: number;
  readonly httpStatus: number | null;
  readonly error: string | null;
  /** When the next attempt is due, or null because there is not one. */
  readonly nextAttemptAt: Date | null;
  /** Whether this attempt was the one that tripped the breaker. */
  readonly endpointDisabled: boolean;
}

/**
 * Sends one delivery and decides what happens next (ADR-0012).
 *
 * Every attempt does four things in this order, and the order is the whole design: sign from what is
 * stored, send, write down what happened, then decide. Deciding last means a crash before the write
 * leaves the delivery due again — at-least-once, which is what the delivery id exists for — while a
 * crash after it leaves a delivery whose state matches what actually happened.
 *
 * Two things it is careful not to do. It never re-signs a body it assembled differently: the
 * envelope is built from the row, so attempt eight covers the same bytes as attempt one and a
 * receiver deduping on the id sees one delivery. And it never treats anything but a 2xx as success —
 * a 302 or a 404 is a receiver that has not taken the delivery, and reading a redirect as delivered
 * is how six months of events go to a URL that moved.
 */
export class WebhookDispatcher {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly signer: WebhookSigner,
    private readonly encryptor: FieldEncryptor,
    private readonly transport: WebhookTransport,
    private readonly scheduler: DeliveryScheduler,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /**
   * Attempts one delivery that has already been claimed.
   *
   * Claimed, not claimable: both callers — the relay's first attempt and the sweeper's recovery —
   * take ownership before they get here, so this cannot be the thing that sends a delivery twice.
   */
  async dispatch(
    projectId: string,
    delivery: WebhookDeliveryRow,
    lane: DeliveryLane,
  ): Promise<DispatchResult | null> {
    const tenant = this.tenantFor(projectId);
    const endpoint = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).findById(delivery.webhookId),
    );
    // The cascade means this should not happen; a delivery whose endpoint went in the same moment
    // is terminal rather than retried, because there is nowhere left to send it.
    if (endpoint === null) {
      await this.settle(tenant, delivery, {
        attempt: {
          n: delivery.attemptCount + 1,
          at: this.clock.now().toISOString(),
          status: null,
          error: "The endpoint was removed.",
          durationMs: 0,
          response: "",
        },
        status: "failed",
        nextAttemptAt: null,
      });
      return null;
    }

    const attemptNumber = delivery.attemptCount + 1;
    const result = await this.send(projectId, delivery, endpoint, lane);
    const decision = this.decide(result, attemptNumber);
    const attempt = {
      n: attemptNumber,
      at: this.clock.now().toISOString(),
      status: result.status,
      error: result.error,
      durationMs: result.durationMs,
      response: result.excerpt,
    };

    await this.settle(tenant, delivery, { attempt, ...decision });
    const disabled = await this.updateEndpointHealth(tenant, endpoint, decision.status, attempt.at);

    // Armed after the row says when it is due, so a scheduler that answers late cannot arrive
    // before the delivery is ready to be attempted again.
    if (decision.nextAttemptAt !== null) {
      await this.arm(delivery, projectId, decision.nextAttemptAt);
    }

    this.logger.info("webhook delivery attempted", {
      component: "webhook-dispatcher",
      outcome: decision.status,
      projectId,
      event: delivery.event,
      attempt: attemptNumber,
      statusCode: result.status ?? 0,
      durationMs: result.durationMs,
    });

    return {
      status: decision.status,
      attempt: attemptNumber,
      httpStatus: result.status,
      error: result.error,
      nextAttemptAt: decision.nextAttemptAt,
      endpointDisabled: disabled,
    };
  }

  /**
   * Signs and sends, from what the row and the endpoint hold.
   *
   * Both secrets in force sign, newest first, so a customer mid-rotation can verify with either
   * (ADR-0012). The previous one is dropped from the header the moment its window closes rather than
   * when the sweep gets around to clearing the column, because the deadline is what was promised.
   */
  private async send(
    projectId: string,
    delivery: WebhookDeliveryRow,
    endpoint: WebhookRow,
    lane: DeliveryLane,
  ): Promise<TransportResult> {
    const envelope = buildWebhookEnvelope({
      deliveryId: PublicId.encode(IdPrefix.Delivery, delivery.id).value,
      type: delivery.event,
      sequence: delivery.sequence,
      // When the event happened, not when this row was written: the envelope promises the former, and
      // a relay behind on a backlog would otherwise report old events as new ones.
      createdAt: delivery.occurredAt,
      projectId: PublicId.encode(IdPrefix.Project, projectId).value,
      data: delivery.payload ?? {},
    });
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(this.clock.nowMs() / 1000);

    return await this.transport.send({
      url: endpoint.url,
      body,
      headers: {
        [WEBHOOK_SIGNATURE_HEADER]: this.signer.sign(
          this.secretsInForce(endpoint, projectId),
          timestamp,
          body,
        ),
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
        [WEBHOOK_DELIVERY_HEADER]: envelope.id,
        [WEBHOOK_EVENT_HEADER]: delivery.event,
        [WEBHOOK_ATTEMPT_HEADER]: String(delivery.attemptCount + 1),
      },
      timeoutMs: lane === "inline" ? WEBHOOK_INLINE_TIMEOUT_MS : WEBHOOK_RETRY_TIMEOUT_MS,
    });
  }

  /** The secrets that sign right now: the current one, and the previous one inside its window. */
  private secretsInForce(endpoint: WebhookRow, projectId: string): string[] {
    const secrets = [this.encryptor.decrypt(endpoint.secretCiphertext, projectId)];
    const until = endpoint.previousSecretUntil;
    if (endpoint.previousSecretCiphertext !== null && until !== null && until > this.clock.now()) {
      secrets.push(this.encryptor.decrypt(endpoint.previousSecretCiphertext, projectId));
    }
    return secrets;
  }

  /**
   * What an attempt means: delivered, due again, or out of attempts.
   *
   * Pure, so the rule can be read and tested without a socket. Anything but a 2xx is a failure,
   * timeouts included, and the schedule is the published one rather than a queue setting.
   */
  private decide(
    result: TransportResult,
    attemptNumber: number,
  ): { status: DeliveryStatus; nextAttemptAt: Date | null } {
    if (result.status !== null && result.status >= 200 && result.status < 300) {
      return { status: "delivered", nextAttemptAt: null };
    }
    const delay =
      attemptNumber >= WEBHOOK_MAX_ATTEMPTS ? null : webhookRetryDelaySeconds(attemptNumber);
    if (delay === null) return { status: "failed", nextAttemptAt: null };
    return { status: "queued", nextAttemptAt: new Date(this.clock.nowMs() + delay * 1000) };
  }

  private async settle(
    tenant: TenantContext,
    delivery: WebhookDeliveryRow,
    outcome: AttemptOutcome,
  ): Promise<void> {
    await this.uow.transaction((tx) =>
      new WebhookDeliveryRepository(tx, tenant).recordAttempt(delivery.id, outcome),
    );
  }

  /**
   * Moves the endpoint's counters, and trips the breaker on the twentieth failure in a row.
   *
   * **The breaker counts attempts, not dead deliveries**, and the first version of this counted
   * dead deliveries — which the integration test exposed as far too patient. A delivery only dies
   * after eight attempts spread over a day, so twenty of them is a month of calling an endpoint
   * that has never once answered. Twenty consecutive failed *attempts* is the same statement made
   * usefully: nothing is getting through, said within minutes rather than within weeks.
   *
   * Consecutive is what keeps it fair to a flaky endpoint. Any success clears the run, so an
   * endpoint that answers some of the time is never switched off — that is what the retry schedule
   * is for — and only one that answers none of the time is.
   *
   * The day's `failed` counter is the other measure and stays as it was: a delivery that will be
   * retried is not yet a failed delivery, and counting it as one would make every retried delivery
   * look like two.
   */
  private async updateEndpointHealth(
    tenant: TenantContext,
    endpoint: WebhookRow,
    status: DeliveryStatus,
    at: string,
  ): Promise<boolean> {
    const when = new Date(at);
    const day = statsDay(when);

    if (status === "delivered") {
      await this.uow.transaction(async (tx) => {
        await new WebhookRepository(tx, tenant).clearFailures(endpoint.id, when);
        await new WebhookStatsRepository(tx, tenant).add(endpoint.id, day, {
          delivered: 1,
          attempts: 1,
          lastDeliveredAt: when,
        });
      });
      return false;
    }

    const terminal = status === "failed";
    return await this.uow.transaction(async (tx) => {
      const endpoints = new WebhookRepository(tx, tenant);
      await new WebhookStatsRepository(tx, tenant).add(endpoint.id, day, {
        attempts: 1,
        ...(terminal ? { failed: 1, lastFailedAt: when } : {}),
      });

      const failures = await endpoints.countFailure(endpoint.id, when);
      if (failures === null || failures < WEBHOOK_FAILURES_BEFORE_DISABLED) return false;
      await endpoints.disable(endpoint.id, "failing", when);
      this.logger.warn("webhook endpoint disabled after consecutive failures", {
        component: "webhook-dispatcher",
        outcome: "disabled",
        failures,
      });
      return true;
    });
  }

  /** Arming is best-effort: the row already says when it is due, so the sweeper is the guarantee. */
  private async arm(delivery: WebhookDeliveryRow, projectId: string, at: Date): Promise<void> {
    try {
      await this.scheduler.schedule(
        { id: delivery.id, projectId, webhookId: delivery.webhookId },
        at,
      );
    } catch (error: unknown) {
      this.logger.warn("webhook retry could not be scheduled", {
        component: "webhook-dispatcher",
        outcome: "degraded",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  private tenantFor(projectId: string): TenantContext {
    return new TenantContext(projectId, "webhook-dispatcher", "system");
  }
}
