import "reflect-metadata";
import { createValkeyClient } from "@idenzy/cache/connection/client";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Sha256WebhookSigner } from "@idenzy/crypto/webhooks/webhook-signer";
import { createLogger } from "@idenzy/observability/logger-factory";
import { createPool } from "@idenzy/persistence/connection/pool";
import { AuditEventReader } from "@idenzy/persistence/repository/audit-event-reader";
import { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";
import { RevocationEventReader } from "@idenzy/persistence/repository/revocation-event-reader";
import { UsageClosableReader } from "@idenzy/persistence/repository/usage-closable-reader";
import { WebhookDueReader } from "@idenzy/persistence/repository/webhook-due-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { drizzle } from "drizzle-orm/node-postgres";
import { AuditRelay } from "./audit-relay.js";
import { MetadataTokenSource } from "./google/access-token-source.js";
import { GoogleOidcVerifier } from "./google/task-caller-verifier.js";
import { InternalServer } from "./http/internal-server.js";
import { RevocationReconciler } from "./revocation-reconciler.js";
import { UsagePeriodCloser } from "./usage-period-closer.js";
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
  const config = AppConfig.fromEnvironment();
  const logger = createLogger({
    level: config.get("LOG_LEVEL"),
    base: { cell: config.get("CELL_CODE"), component: "workers" },
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
   * Cloud Tasks if this deployment was given queues, and the sweeper if it was not. Both are correct:
   * the queue arms a retry to the second, the sweeper finds it on its interval, and only the second
   * of those is a delivery guarantee. A half-configured queue is the one case that fails here rather
   * than quietly costing latency.
   */
  const tasks = CloudTasksScheduler.settingsFrom(config);
  const scheduler: DeliveryScheduler =
    tasks === null
      ? new SweepingScheduler()
      : new CloudTasksScheduler(new MetadataTokenSource(clock), tasks, logger);

  const dispatcher = new WebhookDispatcher(
    uow,
    new Sha256WebhookSigner(),
    new FieldEncryptor(developmentDataKey(config.get("CELL_CODE"))),
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
  await reconciler.start();
  await auditRelay.start();
  await webhookRelay.start();
  await webhookSweeper.start();
  await usageCloser.start();
  await server.start();
  logger.info("workers started", config.toSafeSummary());
}

await bootstrap();
