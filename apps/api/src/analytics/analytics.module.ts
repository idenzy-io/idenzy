import { AnalyticsIngestQueue } from "@idenzy/analytics/ingest/analytics-ingest-queue";
import type { StreamCommands } from "@idenzy/analytics/ingest/stream-commands";
import type { ValkeyClient } from "@idenzy/cache/connection/client";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { AnalyticsRecorder, NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import { Global, Module } from "@nestjs/common";
import { VALKEY } from "../cache/cache.module.js";
import { QueueAnalyticsRecorder } from "./queue-analytics-recorder.js";

/**
 * Where an authentication goes to be counted later (ADR-0013, todo.md 3.2).
 *
 * Global, because the two services that end an authentication both need it and neither of them
 * should be the one deciding whether analytics exist.
 *
 * **A deployment with no analytics store gets the null recorder and is not degraded.** Nothing on
 * the authentication path reads this store, so a cell without one serves sign-ins and draws no
 * charts — which is why the choice is made here, once, rather than by a nullable dependency that
 * puts an `if` at every call site.
 *
 * Only the queue is needed here, which is why this takes the Valkey client and not a ClickHouse
 * one: the API never speaks to the analytics store at all. The worker does, with a different
 * credential, and that separation is the point (a row policy filters reads and does not constrain
 * writes, so nothing that can write should be reachable from a request).
 */
@Global()
@Module({
  providers: [
    {
      provide: AnalyticsRecorder,
      inject: [VALKEY, AppConfig, Logger],
      useFactory: (valkey: ValkeyClient, config: AppConfig, logger: Logger): AnalyticsRecorder =>
        config.get("CLICKHOUSE_URL") === undefined
          ? new NullAnalyticsRecorder()
          : new QueueAnalyticsRecorder(
              new AnalyticsIngestQueue(valkey as unknown as StreamCommands, logger),
            ),
    },
  ],
  exports: [AnalyticsRecorder],
})
export class AnalyticsModule {}
