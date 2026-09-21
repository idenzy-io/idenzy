import { AnalyticsIngestQueue } from "@idenzy/analytics/ingest/analytics-ingest-queue";
import { AUTH_EVENTS_TABLE } from "@idenzy/analytics/schema/tables";
import {
  AnalyticsRecorder,
  type AuthAnalyticsEvent,
} from "@idenzy/domain/ports/analytics-recorder";
import { Injectable } from "@nestjs/common";

/** `YYYY-MM-DD HH:MM:SS.mmm`, which is what ClickHouse's `DateTime64` parses without a timezone. */
function clickHouseInstant(at: Date): string {
  return at.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Puts an authentication on the ingest queue (ADR-0013).
 *
 * The row is shaped here rather than in the worker, for the reason the webhook relay projects its
 * payload at fan-out: the column list is a contract, and building it where the event happens means
 * a new column is added in one place instead of being carried as an open payload that whatever
 * drains the queue has to interpret. Empty strings and not nulls, because every column on the
 * table is non-nullable — ClickHouse charges for a `Nullable` in both storage and read speed, and
 * "no method" is honestly an empty method rather than an unknown one.
 *
 * The tenant is stamped at this point, which is the only point that knows it: the worker drains
 * one queue for a whole cell and writes with an identity that is cross-tenant by design.
 */
@Injectable()
export class QueueAnalyticsRecorder extends AnalyticsRecorder {
  constructor(private readonly queue: AnalyticsIngestQueue) {
    super();
  }

  override async record(event: AuthAnalyticsEvent): Promise<void> {
    await this.queue.enqueue({
      table: AUTH_EVENTS_TABLE,
      projectId: event.projectId,
      row: {
        at: clickHouseInstant(event.at),
        event: event.event,
        method: event.method ?? "",
        outcome: event.outcome,
        user_id: event.userId ?? ZERO_UUID,
        session_id: event.sessionId ?? ZERO_UUID,
        ip: event.ip ?? "",
        user_agent: event.userAgent ?? "",
        // Placing an address is the geography service's job and it is not wired to this path yet.
        // Empty rather than a guess: a country column full of "XX" reads as a country.
        country: "",
      },
    });
  }
}

/** What "no user" looks like in a non-nullable `UUID` column. Never a real id. */
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
