import { ResourceConflictError, ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { generateOpaqueToken } from "@idenzy/crypto/tokens/random";
import {
  WebhookDeliveryRepository,
  type WebhookDeliveryRow,
} from "@idenzy/persistence/repository/webhook-delivery-repository";
import {
  WebhookRepository,
  type WebhookRow,
} from "@idenzy/persistence/repository/webhook-repository";
import {
  statsDay,
  type WebhookDayStats as WebhookDayStatsRow,
  WebhookStatsRepository,
} from "@idenzy/persistence/repository/webhook-stats-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix, WEBHOOK_SECRET_PREFIX } from "@idenzy/protocol/schemas/common";
import type {
  CreatedWebhook,
  CreateWebhook,
  RotatedWebhookSecret,
  UpdateWebhook,
  WebhookDayStats,
  WebhookDelivery,
  WebhookEndpoint,
} from "@idenzy/protocol/schemas/management";
import {
  WEBHOOK_ROTATION_OVERLAP_HOURS,
  WEBHOOK_TEST_EVENT,
  webhookOutcomeOf,
  webhookTestData,
} from "@idenzy/protocol/schemas/webhooks";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/** 24 bytes from the CSPRNG behind the prefix. The panel documents the shape; this mints it. */
const SECRET_BYTES = 24;

/**
 * A project's webhook endpoints: making one, editing it, pausing it, rotating its secret
 * (ADR-0012).
 *
 * The secret is the reason this service holds a `FieldEncryptor`. It is generated here, encrypted
 * here, and the ciphertext is what reaches the repository — so the data layer cannot log a signing
 * key even by accident, and the plaintext exists in exactly one response.
 *
 * "Shown once" is a property of this file rather than of the storage, and the difference is worth
 * being exact about because the panel's note asked for it: the secret is encrypted, not hashed, so
 * we *can* read it back — we need to, in order to sign. What makes it shown once is that no route
 * here answers with it after the two that mint it, and a route that did would be a change somebody
 * has to write and review.
 *
 * Delivery history is read-only and answers what the pipeline has recorded, which today is nothing:
 * no worker consumes the webhook topic yet. That is why a test event and a retry are not here.
 * Either would write a delivery row nothing would ever send, and a screen showing a delivery stuck
 * on "pending" forever is a worse answer than a control that says it is unavailable — which is
 * exactly what the screen says today.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
    private readonly encryptor: FieldEncryptor,
  ) {}

  async list(context: OrgContext, projectId: string): Promise<WebhookEndpoint[]> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.transaction((tx) => new WebhookRepository(tx, tenant).list());
    return rows.map(present);
  }

  /**
   * Creates an endpoint and hands back its signing secret, the only moment anybody has it.
   *
   * The secret is encrypted before it reaches the repository and the plaintext is returned to the
   * caller rather than held anywhere: it travels out of this method and is not written into a
   * field, for the same reason the API key service does not keep one.
   */
  async create(
    context: OrgContext,
    projectId: string,
    body: CreateWebhook,
  ): Promise<CreatedWebhook> {
    const tenant = await this.scope.of(context, projectId);
    const secret = `${WEBHOOK_SECRET_PREFIX}${generateOpaqueToken(SECRET_BYTES)}`;

    const row = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).create({
        url: body.url,
        description: body.description,
        secretCiphertext: this.encrypt(secret, tenant),
        events: body.events,
        allEvents: body.allEvents,
        enabled: body.enabled,
      }),
    );
    return { endpoint: present(row), secret };
  }

  async update(
    context: OrgContext,
    projectId: string,
    webhookId: string,
    body: UpdateWebhook,
  ): Promise<WebhookEndpoint> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    // Spread rather than assigned, because `exactOptionalPropertyTypes` makes an explicit
    // `undefined` a different thing from an absent key — and here they mean different things too:
    // absent is "leave it alone", where a value is "set it to this".
    const change = {
      ...(body.url === undefined ? {} : { url: body.url }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.events === undefined ? {} : { events: body.events }),
      ...(body.allEvents === undefined ? {} : { allEvents: body.allEvents }),
    };
    const row = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).update(id, change),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { webhookId } });
    return present(row);
  }

  /**
   * Pauses an endpoint, naming the membership that did it.
   *
   * A person's pause and the breaker's switch-off are the same column and deliberately not the same
   * state: the screen says which, because "off because you turned it off" and "off because your
   * server refused twenty deliveries" call for entirely different next steps.
   */
  async pause(context: OrgContext, projectId: string, webhookId: string): Promise<WebhookEndpoint> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    // The acting membership, from the context rather than from a parameter: the guard already
    // resolved who this request is, and a caller passing its own idea of that is a caller that
    // could pass somebody else's.
    const row = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).disable(id, "paused", new Date(), context.actorId),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { webhookId } });
    return present(row);
  }

  /**
   * Turns it back on, which also clears the breaker's counter.
   *
   * Nothing that happened while it was off is replayed. Those events were not queued for it: the
   * fan-out writes a delivery for enabled endpoints only, so a paused endpoint has no backlog to
   * release — which is what the remove dialog's "queued-event behaviour" question comes down to.
   */
  async resume(
    context: OrgContext,
    projectId: string,
    webhookId: string,
  ): Promise<WebhookEndpoint> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    const row = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).enable(id, new Date()),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { webhookId } });
    return present(row);
  }

  /**
   * Replaces the signing secret, leaving the old one signing until the deadline.
   *
   * The window is what makes a rotation deployable: both secrets sign every delivery for
   * `WEBHOOK_ROTATION_OVERLAP_HOURS`, so a receiver can ship the new one whenever it suits them and
   * no delivery in between fails verification. The deadline is returned rather than only stored,
   * because it is the one thing the customer has to act before.
   */
  async rotateSecret(
    context: OrgContext,
    projectId: string,
    webhookId: string,
  ): Promise<RotatedWebhookSecret> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    const now = new Date();
    const until = new Date(now.getTime() + WEBHOOK_ROTATION_OVERLAP_HOURS * 3_600_000);
    const secret = `${WEBHOOK_SECRET_PREFIX}${generateOpaqueToken(SECRET_BYTES)}`;

    const row = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).rotateSecret(id, this.encrypt(secret, tenant), until, now),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { webhookId } });
    return { endpoint: present(row), secret, previousSecretUntil: until.toISOString() };
  }

  /** Removes an endpoint, and with it every delivery and counter it had. */
  async remove(context: OrgContext, projectId: string, webhookId: string): Promise<void> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    const removed = await this.uow.transaction((tx) =>
      new WebhookRepository(tx, tenant).remove(id),
    );
    if (!removed) throw new ResourceNotFoundError({ detail: { webhookId } });
  }

  /**
   * One endpoint's recent deliveries, newest first.
   *
   * Scoped to an endpoint rather than to the project, because that is the question somebody debugging
   * has: this endpoint is failing, what did it answer. It also bounds the read, which the window
   * behind it does not.
   */
  async deliveries(
    context: OrgContext,
    projectId: string,
    webhookId: string,
    limit: number,
  ): Promise<WebhookDelivery[]> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    const rows = await this.uow.transaction(async (tx) => {
      // Checked rather than assumed, so an endpoint that is not this project's answers as absent
      // instead of as an endpoint with no deliveries.
      const endpoint = await new WebhookRepository(tx, tenant).findById(id);
      if (endpoint === null) return null;
      return await new WebhookDeliveryRepository(tx, tenant).listForEndpoint(id, limit);
    });
    if (rows === null) throw new ResourceNotFoundError({ detail: { webhookId } });
    return rows.map(presentDelivery);
  }

  /**
   * The endpoints' daily counters since a day, for the figures strip.
   *
   * Project-wide in one read, because the strip is about the project rather than about whichever
   * endpoint is selected. A day per endpoint is a few dozen bytes, so a month of a project with ten
   * endpoints is three hundred rows — which is why this can be a read rather than an aggregate.
   */
  async stats(context: OrgContext, projectId: string, since: string): Promise<WebhookDayStats[]> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.transaction((tx) =>
      new WebhookStatsRepository(tx, tenant).forProject(since),
    );
    return rows.map(presentStats);
  }

  /** The default window: a week back, which is what the screen opens on. */
  static defaultStatsSince(now: Date): string {
    return statsDay(new Date(now.getTime() - 6 * 86_400_000));
  }

  /**
   * Queues a test delivery, which the pipeline sends like any other.
   *
   * Written as a delivery rather than dispatched here, and that is the whole design: this service is
   * the control plane and has no signing key, no transport and no business holding either. It writes
   * a row that is due now, and the sweeper in `apps/workers` picks it up on its next pass — the same
   * path a retry takes, so a test proves the real pipeline rather than a shortcut through it.
   *
   * Allowed on a disabled endpoint, because that is when it is most useful: a new endpoint starts off
   * so that a test can come before real events reach it.
   */
  async sendTest(
    context: OrgContext,
    projectId: string,
    webhookId: string,
  ): Promise<WebhookDelivery> {
    const tenant = await this.scope.of(context, projectId);
    const id = this.uuidOf(webhookId);
    const row = await this.uow.transaction(async (tx) => {
      const endpoint = await new WebhookRepository(tx, tenant).findById(id);
      if (endpoint === null) return null;
      return await new WebhookDeliveryRepository(tx, tenant).createTest(
        id,
        WEBHOOK_TEST_EVENT,
        webhookTestData(PublicId.encode(IdPrefix.Project, tenant.projectId).value),
        new Date(),
      );
    });
    if (row === null) throw new ResourceNotFoundError({ detail: { webhookId } });
    return presentDelivery(row);
  }

  /**
   * Sends a finished delivery again, with the same id and the same body.
   *
   * The same id is the point: a receiver that already took it recognises it and does nothing, which
   * is what makes a replay safe to offer at all.
   *
   * Three refusals, each the honest answer rather than an obstacle. A delivery still being attempted
   * does not need replaying. One that was taken has nothing to send again, and its body is gone for
   * that reason. And one whose body a retention pass has cleared cannot be replayed at all, because
   * re-signing something assembled now would be a different delivery wearing an old id (ADR-0012).
   */
  async replay(
    context: OrgContext,
    projectId: string,
    webhookId: string,
    deliveryId: string,
  ): Promise<WebhookDelivery> {
    const tenant = await this.scope.of(context, projectId);
    const endpoint = this.uuidOf(webhookId);
    const delivery = PublicId.parse(IdPrefix.Delivery, deliveryId).uuid;

    const row = await this.uow.transaction(async (tx) => {
      const deliveries = new WebhookDeliveryRepository(tx, tenant);
      const held = await deliveries.findById(delivery);
      // Not this endpoint's is the same answer as not there, so a delivery id cannot be used to
      // learn which endpoint it belongs to.
      if (held === null || held.webhookId !== endpoint) {
        throw new ResourceNotFoundError({ detail: { deliveryId } });
      }
      if (held.status === "queued" || held.status === "delivering") {
        throw new ResourceConflictError({
          message: "That delivery has not finished yet, so it is already going to be attempted.",
          detail: { deliveryId },
        });
      }
      if (held.status === "delivered") {
        throw new ResourceConflictError({
          message: "That delivery was taken, so there is nothing to send again.",
          detail: { deliveryId },
        });
      }
      if (held.payload === null) {
        throw new ResourceConflictError({
          message:
            "That delivery's body is no longer held, so it cannot be sent again. Send a test event instead.",
          detail: { deliveryId },
        });
      }
      return await deliveries.reopen(delivery, new Date());
    });
    if (row === null) throw new ResourceNotFoundError({ detail: { deliveryId } });
    return presentDelivery(row);
  }

  private encrypt(secret: string, tenant: TenantContext): string {
    return this.encryptor.encrypt(secret, tenant.projectId);
  }

  private uuidOf(webhookId: string): string {
    return PublicId.parse(IdPrefix.Webhook, webhookId).uuid;
  }
}

function present(row: WebhookRow): WebhookEndpoint {
  return {
    id: PublicId.encode(IdPrefix.Webhook, row.id).value,
    url: row.url,
    description: row.description,
    enabled: row.enabled,
    disabled:
      row.disabledAt === null || row.disabledReason === null
        ? null
        : {
            kind: row.disabledReason,
            at: row.disabledAt.toISOString(),
            byMemberId:
              row.disabledBy === null
                ? null
                : PublicId.encode(IdPrefix.Member, row.disabledBy).value,
          },
    events: [...row.events],
    allEvents: row.allEvents,
    createdAt: row.createdAt.toISOString(),
    rolledAt: row.rolledAt?.toISOString() ?? null,
    // Only meaningful while the window is open. The sweep that clears the ciphertext clears this
    // with it, so a closed rotation reads as no rotation in progress rather than as a past date.
    previousSecretUntil: row.previousSecretUntil?.toISOString() ?? null,
  };
}

function presentDelivery(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: PublicId.encode(IdPrefix.Delivery, row.id).value,
    endpointId: PublicId.encode(IdPrefix.Webhook, row.webhookId).value,
    event: row.event,
    outcome: webhookOutcomeOf(row.status),
    attempts: row.attempts.map((attempt) => ({ ...attempt })),
    // Null for a terminal delivery, which is also when the row stops carrying a payload.
    nextRetryAt: row.status === "queued" ? (row.nextAttemptAt?.toISOString() ?? null) : null,
    payload: row.payload === null ? null : { ...row.payload },
    createdAt: row.createdAt.toISOString(),
    test: row.test,
  };
}

function presentStats(row: WebhookDayStatsRow): WebhookDayStats {
  return {
    endpointId: PublicId.encode(IdPrefix.Webhook, row.webhookId).value,
    day: row.day,
    delivered: row.delivered,
    failed: row.failed,
    attempts: row.attempts,
    lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
    lastFailedAt: row.lastFailedAt?.toISOString() ?? null,
  };
}
