import "reflect-metadata";
import { createValkeyClient } from "@idenzy/cache/connection/client";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { AppConfig } from "@idenzy/config/app-config";
import { SystemClock } from "@idenzy/core/time/clock";
import { createLogger } from "@idenzy/observability/logger-factory";
import { createPool } from "@idenzy/persistence/connection/pool";
import { RevocationEventReader } from "@idenzy/persistence/repository/revocation-event-reader";
import { drizzle } from "drizzle-orm/node-postgres";
import { RevocationReconciler } from "./revocation-reconciler.js";

/**
 * Standalone consumers: email, sms, webhook, audit, analytics, dsr and retention
 * (PROJECT.md 9.1). No HTTP server.
 *
 * The revocation reconciler is the first of them and is not a queue consumer: it sweeps the
 * outbox on a timer and replays what it finds into the cache, which is what makes the
 * revocation set survive a Valkey restart (ADR-0009). The rest arrive with the flows that
 * produce their messages.
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

  // Awaited, so a worker that has just started has already put the window back before it
  // reports itself up. A restart is exactly when the cache is most likely to be empty.
  await reconciler.start();
  logger.info("workers started", config.toSafeSummary());
}

await bootstrap();
