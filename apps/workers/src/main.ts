import "reflect-metadata";
import { ClickHouseClient } from "@idenzy/analytics/client/clickhouse-client";
import {
  AnalyticsEraser,
  ERASABLE_ANALYTICS_TABLES,
} from "@idenzy/analytics/erasure/analytics-eraser";
import { AnalyticsIngestQueue } from "@idenzy/analytics/ingest/analytics-ingest-queue";
import { AnalyticsIngestWorker } from "@idenzy/analytics/ingest/analytics-ingest-worker";
import type { StreamCommands } from "@idenzy/analytics/ingest/stream-commands";
import { migrateAnalytics } from "@idenzy/analytics/migrate";
import { AutoTopUpRuleCache } from "@idenzy/cache/auto-top-up-rule-cache";
import { createValkeyClient } from "@idenzy/cache/connection/client";
import { DueSet } from "@idenzy/cache/due-set";
import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { LiveUsageSketches } from "@idenzy/cache/live-usage-sketches";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { SpacingGate } from "@idenzy/cache/spacing-gate";
import {
  AUTO_TOP_UP_DUE_KEY,
  DRAWDOWN_DUE_KEY,
  ValkeyBillingSignals,
} from "@idenzy/cache/valkey-billing-signals";
import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { fieldEncryptorFor } from "@idenzy/crypto/encryption/field-key";
import { Sha256WebhookSigner } from "@idenzy/crypto/webhooks/webhook-signer";
import { createLogger } from "@idenzy/observability/logger-factory";
import { createPool } from "@idenzy/persistence/connection/pool";
import { AuditEventReader } from "@idenzy/persistence/repository/audit-event-reader";
import { AuditPartitionMaintainer } from "@idenzy/persistence/repository/audit-partition-maintainer";
import { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import { EmailProviderEventRepository } from "@idenzy/persistence/repository/email-provider-event-repository";
import { EmailRetentionPruner } from "@idenzy/persistence/repository/email-retention-pruner";
import { ErasedUserCopies } from "@idenzy/persistence/repository/erased-user-copies";
import { OrgUsageActivityReader } from "@idenzy/persistence/repository/org-usage-activity-reader";
import { ProjectEmailActivityReader } from "@idenzy/persistence/repository/project-email-activity-reader";
import { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";
import { RetentionPruner } from "@idenzy/persistence/repository/retention-pruner";
import { RevocationEventReader } from "@idenzy/persistence/repository/revocation-event-reader";
import { UsageActiveProjectsReader } from "@idenzy/persistence/repository/usage-active-projects-reader";
import { UsageClosableReader } from "@idenzy/persistence/repository/usage-closable-reader";
import { UsageRetentionPruner } from "@idenzy/persistence/repository/usage-retention-pruner";
import { WebhookDueReader } from "@idenzy/persistence/repository/webhook-due-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PERSONAL_EVENT_FIELDS } from "@idenzy/protocol/schemas/webhooks";
import {
  SnsMessageVerifier,
  SnsSubscriptionConfirmer,
} from "@idenzy/providers-email/aws/sns-message-verifier";
import { AdcTokenSource } from "@idenzy/providers-gcp/access-token-source";
import { keyEncryptionFor } from "@idenzy/providers-gcp/key-encryption-for";
import { SecretManagerSource } from "@idenzy/providers-gcp/secret-manager-source";
import { StripePaymentProvider } from "@idenzy/providers-payment/stripe-payment-provider";
import { stripeSettingsFrom } from "@idenzy/providers-payment/stripe-settings";
import { drizzle } from "drizzle-orm/node-postgres";
import { analyticsSettingsFrom } from "./analytics-settings.js";
import { AuditPartitionKeeper } from "./audit-partition-keeper.js";
import { AuditRelay } from "./audit-relay.js";
import { AutoTopUpRunner } from "./billing/auto-top-up-runner.js";
import { AutoTopUpSweeper } from "./billing/auto-top-up-sweeper.js";
import { BillingSignalConsumer } from "./billing/billing-signal-consumer.js";
import { InvoiceRunner } from "./billing/invoice-runner.js";
import { LiveBalance } from "./billing/live-balance.js";
import { EmailEventEndpoint } from "./email/email-event-endpoint.js";
import { EmailReputationBreaker } from "./email/email-reputation-breaker.js";
import { EmailRetentionSweeper } from "./email/email-retention-sweeper.js";
import { GoogleOidcVerifier } from "./google/task-caller-verifier.js";
import { HourlyUsageRoller } from "./hourly-usage-roller.js";
import { InternalServer } from "./http/internal-server.js";
import { RetentionSweeper } from "./retention-sweeper.js";
import { RevocationReconciler } from "./revocation-reconciler.js";
import { UsageDrawdown } from "./usage-drawdown.js";
import { UsagePeriodCloser } from "./usage-period-closer.js";
import { UsageRetentionSweeper } from "./usage-retention-sweeper.js";
import {
  analyticsTarget,
  type ErasureTarget,
  messagingTarget,
  UserErasureRelay,
} from "./user-erasure-relay.js";
import { CloudTasksScheduler } from "./webhooks/cloud-tasks-scheduler.js";
import { type DeliveryScheduler, SweepingScheduler } from "./webhooks/delivery-scheduler.js";
import { WebhookDispatcher } from "./webhooks/webhook-dispatcher.js";
import { WebhookRelay } from "./webhooks/webhook-relay.js";
import { WebhookSweeper } from "./webhooks/webhook-sweeper.js";
import { WebhookTaskEndpoint } from "./webhooks/webhook-task-endpoint.js";
import { HttpsWebhookTransport } from "./webhooks/webhook-transport.js";

/**
 * Standalone consumers: email, sms, webhook, audit, analytics, dsr and retention
 * (PROJECT.md 9.1).
 *
 * Two of them are here. The revocation reconciler sweeps the outbox on a timer and replays
 * what it finds into the cache, which is what makes the revocation set survive a Valkey
 * restart (ADR-0009). The audit relay drains the audit topic into the hash-chained trail,
 * and it is the only writer of that chain by design: two request handlers reading the same
 * tip would both link to it and fork it (PROJECT.md 4.13.3).
 *
 * Neither is a queue consumer yet. Both read the outbox directly, each with its own
 * watermark, because `published_at` belongs to the Pub/Sub relay that will replace this
 * arrangement. The rest arrive with the flows that produce their messages.
 *
 * There is an HTTP surface now, which the comment above used to deny: two routes, health and the
 * retry lane's entry, because Cloud Tasks delivers a retry by calling a URL and a Cloud Run service
 * has to listen on `$PORT` to be considered up at all. It is not an API and does not grow into one —
 * anything a customer or the panel can reach belongs to `auth-api` or `management-api`.
 */

/**
 * How much longer than a token's own lifetime an entry is kept, matching the auth API.
 *
 * The two have to agree. A reconciler sweeping a shorter window than the set retains would
 * stop replaying entries the set is still publishing, and the gap would only be visible as a
 * revocation that came back after a restart and then vanished again.
 */
const SKEW_SECONDS = 60;

async function bootstrap(): Promise<void> {
  const config = await AppConfig.bootstrap((projectId) => new SecretManagerSource(projectId));
  const logger = createLogger({
    level: config.get("LOG_LEVEL"),
    service: "workers",
    base: { env: config.get("IDENZY_ENV") },
  });
  const clock = new SystemClock();
  const retentionSeconds = config.get("ACCESS_TOKEN_TTL_SECONDS") + SKEW_SECONDS;

  const db = drizzle(
    createPool({
      connectionString: config.get("DATABASE_URL"),
      max: config.get("DATABASE_POOL_MAX"),
      statementTimeoutMillis: config.get("DATABASE_STATEMENT_TIMEOUT_MS"),
    }),
  );
  const valkey = createValkeyClient({
    url: config.get("VALKEY_URL"),
    onError: (error) => {
      logger.error("valkey connection error", {
        component: "valkey",
        outcome: "unavailable",
        errorCode: error.name,
      });
    },
  });

  const drawdownDue = new DueSet(valkey, DRAWDOWN_DUE_KEY);
  const autoTopUpDue = new DueSet(valkey, AUTO_TOP_UP_DUE_KEY);
  const ruleCache = new AutoTopUpRuleCache(valkey);
  const signals = new ValkeyBillingSignals(
    drawdownDue,
    autoTopUpDue,
    ruleCache,
    clock,
    (signal, cause) => {
      logger.warn("billing signal not sent", {
        component: "billing",
        outcome: signal,
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    },
  );

  const reconciler = new RevocationReconciler(
    new RevocationEventReader(db),
    new RevocationSet(valkey, clock, retentionSeconds),
    clock,
    logger,
    { retentionSeconds },
  );

  const auditRelay = new AuditRelay(
    new AuditEventReader(db),
    new RelayOffsetRepository(db),
    clock,
    logger,
  );

  /*
   * Webhooks (ADR-0012). The relay turns events into deliveries and makes the first attempt; the
   * sweeper is what gets back to everything else.
   *
   * The encryptor is the same shape as auth-api's and refuses the same way: the real data key is
   * per project and KMS-wrapped, and a deployment that signed customers' deliveries with a key
   * derived from the cell code — which is not a secret — would be worse than one that will not
   * start. Nothing else in this worker needs key material.
   */
  if (config.isProduction) {
    throw new InternalError({
      detail: {
        reason: "the per-project KMS-wrapped data key is not implemented",
        rule: "webhook signing secrets are decrypted under a derived key, development only",
      },
    });
  }
  const uow = new UnitOfWork(db);

  /*
   * Metering has one pass that is not on any request path: a month can only be totalled from the
   * sketches that made it, so something has to take that union and then let 16 KiB a day go
   * (PROJECT.md 5.1). It waits a grace period after the month ends, because a meter holds active
   * users in memory and an instance throttled over the turn of the month still has the last of it
   * to write.
   */
  const usageCloser = new UsagePeriodCloser(new UsageClosableReader(db), uow, clock, logger);

  /*
   * The other two halves of metering. The roller writes an hour the first time it sees one
   * complete, because an hour's level and its share of the day's counters are only true at the
   * moment they are taken; the sweeper is what turns three declared retention tiers into three
   * facts, which until it existed they were not.
   */
  const usageRoller = new HourlyUsageRoller(new UsageActiveProjectsReader(db), uow, clock, logger);

  /*
   * What usage costs, taken out of the wallet (ADR-0014).
   *
   * The half that makes a balance a balance rather than a counter. It reprices each
   * organisation's month and charges the difference from what it has already charged, which
   * is what makes it safe to run twice, safe to run beside itself, and correct across every
   * band boundary without knowing where they are.
   */
  const drawdown = new UsageDrawdown(uow, new OrgUsageActivityReader(db), clock, logger, signals);

  /*
   * The automatic top-up and the five-second billing tick (ADR-0017).
   *
   * Valkey carries hints — which projects' usage moved, which organisations' wallets did — and
   * never an amount. The drawdown reprices on those hints as well as on its own pass, and the
   * rule looks at an organisation within a tick of its balance falling. Postgres is still the
   * only thing a charge rests on: the rule decides under a row lock, the database allows one
   * open automatic charge per organisation, and Stripe is asked under an idempotency key.
   *
   * No provider configured means no rule can fire. That is a correct deployment, the same one
   * the management API already treats as correct, and the wallet marks are drained and dropped.
   */
  const stripe = stripeSettingsFrom({
    STRIPE_SECRET_KEY: config.get("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: config.get("STRIPE_WEBHOOK_SECRET"),
    STRIPE_API_VERSION: config.get("STRIPE_API_VERSION"),
    STRIPE_CHECKOUT_SUCCESS_URL: config.get("STRIPE_CHECKOUT_SUCCESS_URL"),
    STRIPE_CHECKOUT_CANCEL_URL: config.get("STRIPE_CHECKOUT_CANCEL_URL"),
  });
  const billingWork = new BillingWorkReader(db);
  const autoTopUp =
    stripe === null
      ? null
      : new AutoTopUpRunner(
          uow,
          new StripePaymentProvider(stripe),
          ruleCache,
          signals,
          billingWork,
          clock,
          logger,
        );
  /*
   * Month-end invoices for the organisations staff chose to bill in arrears (ADR-0019). Drafted in
   * Postgres, then issued through Stripe Invoicing on the organisation's terms; nothing stops over
   * an unpaid one. Without a provider there is nothing to issue through, and nothing is drafted.
   */
  const invoiceRunner =
    stripe === null
      ? null
      : new InvoiceRunner(
          uow,
          new StripePaymentProvider(stripe),
          billingWork,
          signals,
          clock,
          logger,
        );
  const autoTopUpSweeper =
    autoTopUp === null
      ? null
      : new AutoTopUpSweeper(autoTopUp, billingWork, new LiveBalanceCache(valkey), logger);
  const billingSignals = new BillingSignalConsumer(
    drawdownDue,
    autoTopUpDue,
    new SpacingGate(valkey, "billing:drawdown:spacing:"),
    billingWork,
    drawdown,
    new LiveBalance(uow, new LiveUsageSketches(valkey), new LiveBalanceCache(valkey), clock),
    ruleCache,
    autoTopUp,
    clock,
    logger,
  );

  /*
   * The SES feedback loop (PROJECT.md 11.2 item 4, risks.md 2b).
   *
   * Until this existed no bounce or complaint reached us at all: the suppression list had one
   * writer in the whole repository and it was a test, so an address that hard-bounced in March
   * was still being written to in September. The receiver is here rather than on an API because
   * 11.2 names an `email-events` worker, and because SNS is not a customer or the panel.
   *
   * Both variables or neither. A receiver with no topic ARN would accept a validly-signed
   * message from any topic anybody cared to point at it, which is a stranger deciding whose
   * addresses we suppress — so a half-configured pair is no route rather than an open one.
   */
  const sesEventUrl = config.get("SES_EVENT_URL");
  const sesTopicArn = config.get("SES_EVENT_TOPIC_ARN");
  if ((sesEventUrl === undefined) !== (sesTopicArn === undefined)) {
    throw new InternalError({
      detail: {
        reason: "SES event publishing needs both SES_EVENT_URL and SES_EVENT_TOPIC_ARN, or neither",
        rule: "a receiver without a topic allowlist accepts any topic's signed messages",
      },
    });
  }
  const emailEvents =
    sesEventUrl === undefined || sesTopicArn === undefined
      ? null
      : {
          path: new URL(sesEventUrl).pathname,
          endpoint: new EmailEventEndpoint(
            uow,
            new EmailProviderEventRepository(db),
            new SnsMessageVerifier({ topicArns: [sesTopicArn] }),
            new SnsSubscriptionConfirmer(),
            clock,
            logger,
          ),
        };

  /*
   * What stops a project whose mail is damaging the SES account every other customer sends
   * through (risks.md 2). Evaluated here and read on the send path, because a rate recomputed
   * per message is a windowed aggregate on the hot path and a figure nobody can be shown.
   */
  const reputation = new EmailReputationBreaker(
    uow,
    new ProjectEmailActivityReader(db),
    clock,
    logger,
  );

  /*
   * And the sweeper that makes the two new tables' declared retention true rather than
   * described, which is the trap the usage rollups fell into first.
   */
  const emailRetention = new EmailRetentionSweeper(new EmailRetentionPruner(db), clock, logger);

  /*
   * Analytics ingestion (ADR-0013). A cell with no ClickHouse configured runs without it rather
   * than failing, because nothing on the authentication path reads that store — but a cell with
   * *half* of it configured fails at boot, because the symptom would otherwise be an empty chart
   * nobody is watching.
   *
   * The schema is migrated here rather than by a separate step. It is two idempotent statements
   * per table and one of them is the row policy, which is the one thing that must never be
   * skipped: a table without it is readable across every project and errors nowhere.
   */
  const analytics = analyticsSettingsFrom(config);
  const ingest =
    analytics === null
      ? null
      : new AnalyticsIngestWorker(
          valkey as unknown as StreamCommands,
          new ClickHouseClient({
            url: analytics.url,
            database: analytics.database,
            user: analytics.ingestUser,
            password: analytics.password,
          }),
          clock,
          logger,
        );
  const usageRetention = new UsageRetentionSweeper(new UsageRetentionPruner(db), clock, logger);

  /*
   * Erasure's second half (PROJECT.md 4.13.6): the copies of an erased user that messaging and
   * analytics made, which the API's transaction cannot reach. The analytics target exists only
   * where the store does, and runs as the erasure identity, which can delete rows and nothing else.
   */
  const erasureTargets: ErasureTarget[] = [
    messagingTarget((users) => new ErasedUserCopies(db).strip(users, PERSONAL_EVENT_FIELDS), clock),
  ];
  if (analytics !== null) {
    const queue = new AnalyticsIngestQueue(valkey as unknown as StreamCommands, logger);
    const eraser = new AnalyticsEraser(
      new ClickHouseClient({
        url: analytics.url,
        database: analytics.database,
        user: analytics.eraserUser,
        password: analytics.password,
      }),
      analytics.database,
    );
    erasureTargets.push(
      analyticsTarget(
        async () => {
          const heads = await Promise.all(
            ERASABLE_ANALYTICS_TABLES.map((table) => queue.oldestQueuedAt(table.name)),
          );
          const queued = heads.flatMap((head) => (head === null ? [] : [head.getTime()]));
          return queued.length === 0 ? null : new Date(Math.min(...queued));
        },
        (users) => eraser.erase(users),
        clock,
      ),
    );
  }
  const erasureRelay = new UserErasureRelay(
    new AuditEventReader(db),
    new RelayOffsetRepository(db),
    erasureTargets,
    logger,
  );

  /*
   * The customer's own retention, which is a different thing from the usage tiers above: those
   * are ours and fixed, these are each project's and chosen. Until this existed the settings
   * screen offered five ages and nothing deleted a row on account of any of them, so every
   * table's real retention was "forever" while `classified()` published ninety days — and a
   * data map is what a customer is shown (4.13.6).
   */
  const retention = new RetentionSweeper(new RetentionPruner(db), logger);

  /*
   * The one job here whose failure is not deferred work. Every sweeper above leaves rows that
   * are still there and still past their age when a pass fails; this one, left alone, ends with
   * `audit_events` having no partition for the current month and refusing every insert — the
   * append-only trail going dark rather than falling behind (4.13.3).
   */
  const auditPartitions = new AuditPartitionKeeper(new AuditPartitionMaintainer(db), logger);

  /*
   * Cloud Tasks if this deployment was given queues, and the sweeper if it was not. Both are correct:
   * the queue arms a retry to the second, the sweeper finds it on its interval, and only the second
   * of those is a delivery guarantee. A half-configured queue is the one case that fails here rather
   * than quietly costing latency.
   */
  const tasks = CloudTasksScheduler.settingsFrom(config);
  const scheduler: DeliveryScheduler =
    tasks === null
      ? new SweepingScheduler()
      : new CloudTasksScheduler(new AdcTokenSource(), tasks, logger);

  const dispatcher = new WebhookDispatcher(
    uow,
    new Sha256WebhookSigner(),
    await fieldEncryptorFor(
      config.get("IDENZY_ENV"),
      config.get("FIELD_KEY_WRAPPED"),
      keyEncryptionFor(config.get("IDENZY_ENV"), config.get("KMS_KEY_NAME")),
    ),
    // Loopback over plain http is allowed here for the same reason cookie mode is: a developer
    // running their own receiver on localhost has no other way to try this, and a production
    // deployment calling loopback would be calling itself.
    new HttpsWebhookTransport({ allowLoopbackHttp: !config.isProduction }),
    scheduler,
    clock,
    logger,
  );
  const webhookRelay = new WebhookRelay(
    new AuditEventReader(db),
    new RelayOffsetRepository(db),
    uow,
    dispatcher,
    clock,
    logger,
  );
  const webhookSweeper = new WebhookSweeper(
    new WebhookDueReader(db),
    uow,
    dispatcher,
    clock,
    logger,
  );

  /*
   * The retry lane's entry, and health. The path is taken from the URL the tasks themselves name, so
   * the target and the route cannot drift apart; without a queue there is no route at all rather than
   * an unauthenticated one, because an endpoint that dispatches deliveries is not something to leave
   * listening on the chance it is wanted.
   */
  const server = new InternalServer(
    {
      port: config.get("WORKERS_PORT") ?? config.get("PORT"),
      ...(emailEvents === null ? {} : { events: emailEvents }),
      ...(tasks === null
        ? {}
        : {
            dispatch: {
              path: new URL(tasks.url).pathname,
              verifier: new GoogleOidcVerifier({
                audience: tasks.audience,
                serviceAccount: tasks.serviceAccount,
              }),
              endpoint: new WebhookTaskEndpoint(uow, dispatcher, clock, logger),
            },
          }),
    },
    logger,
  );

  // All awaited, so a worker that has just started has already done a pass before it
  // reports itself up. A restart is exactly when the cache is most likely to be empty, and
  // it is also when the audit trail is furthest behind.
  // First, and deliberately before the audit relay: the relay's whole job is inserting into
  // `audit_events`, and an insert with no partition to land in fails outright.
  await auditPartitions.start();
  await reconciler.start();
  await auditRelay.start();
  await webhookRelay.start();
  await webhookSweeper.start();
  await usageCloser.start();
  await usageRoller.start();
  drawdown.start();
  billingSignals.start();
  await autoTopUpSweeper?.start();
  await invoiceRunner?.start();
  reputation.start();
  await usageRetention.start();
  await emailRetention.start();
  await retention.start();
  if (analytics !== null && ingest !== null) {
    await migrateAnalytics(
      new ClickHouseClient({
        url: analytics.url,
        database: analytics.database,
        user: analytics.ownerUser,
        password: analytics.password,
      }),
      {
        database: analytics.database,
        appUser: analytics.appUser,
        ingestUser: analytics.ingestUser,
        eraserUser: analytics.eraserUser,
      },
    );
    // One consumer name per process. Two workers with the same name share a pending list, which is
    // the one thing a consumer group cannot tell apart from a single one that keeps crashing.
    await ingest.start(`workers-${String(process.pid)}`);
  }
  // After the analytics schema exists, since one of its targets deletes from it.
  await erasureRelay.start();
  await server.start();
  logger.info("workers started", config.toSafeSummary());
}

await bootstrap();
