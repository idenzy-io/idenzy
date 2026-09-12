import { InternalError } from "@idenzy/core/errors";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { webhookEndpointStats } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface WebhookDayStats {
  readonly webhookId: string;
  /** The UTC day, as `YYYY-MM-DD`. */
  readonly day: string;
  readonly delivered: number;
  readonly failed: number;
  /** Attempts made, which is more than deliveries: a retry is an attempt, not a delivery. */
  readonly attempts: number;
  readonly lastDeliveredAt: Date | null;
  readonly lastFailedAt: Date | null;
}

/** What one concluded delivery adds to the day. */
export interface StatsIncrement {
  readonly delivered?: number;
  readonly failed?: number;
  readonly attempts?: number;
  readonly lastDeliveredAt?: Date;
  readonly lastFailedAt?: Date;
}

function toRow(row: typeof webhookEndpointStats.$inferSelect): WebhookDayStats {
  return {
    webhookId: row.webhookId,
    day: row.day,
    delivered: row.delivered,
    failed: row.failed,
    attempts: row.attempts,
    lastDeliveredAt: row.lastDeliveredAt,
    lastFailedAt: row.lastFailedAt,
  };
}

/** The UTC day a timestamp falls in. UTC and not the reader's zone: a counter has no locale. */
export function statsDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * What an endpoint has done, a day at a time (ADR-0012).
 *
 * The health figures on the webhooks screen are counters because the alternative is arithmetic
 * over the delivery window, which means scanning every delivery a project made to answer "97%
 * over seven days". At the volume this pipeline is designed for that query is the most expensive
 * thing on the screen, and it would get slower exactly as a customer's traffic grew.
 *
 * Counters are also what survives the window. A delivery is gone after three days; the fact that
 * four thousand of them landed on Tuesday is a row of a few dozen bytes that can be kept for as
 * long as the project, because it names nobody.
 */
export class WebhookStatsRepository extends BaseRepository<typeof webhookEndpointStats> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, webhookEndpointStats);
  }

  /**
   * Adds to a day's counters, creating the row if this is the day's first delivery.
   *
   * `ON CONFLICT DO UPDATE` with the increment computed in SQL, because two dispatchers finishing
   * two deliveries for one endpoint in the same second is the normal case and a read-then-write
   * would lose one of them. The `last` timestamps take the later of what is there and what
   * arrived, so an attempt recorded out of order cannot move them backwards.
   */
  async add(webhookId: string, day: string, change: StatsIncrement): Promise<WebhookDayStats> {
    const delivered = change.delivered ?? 0;
    const failed = change.failed ?? 0;
    const attempts = change.attempts ?? 0;
    const rows = await this.guard(() =>
      this.tx
        .insert(webhookEndpointStats)
        .values({
          projectId: this.context.projectId,
          webhookId,
          day,
          delivered,
          failed,
          attempts,
          ...(change.lastDeliveredAt === undefined
            ? {}
            : { lastDeliveredAt: change.lastDeliveredAt }),
          ...(change.lastFailedAt === undefined ? {} : { lastFailedAt: change.lastFailedAt }),
        })
        .onConflictDoUpdate({
          target: [webhookEndpointStats.webhookId, webhookEndpointStats.day],
          set: {
            delivered: sql`${webhookEndpointStats.delivered} + ${delivered}`,
            failed: sql`${webhookEndpointStats.failed} + ${failed}`,
            attempts: sql`${webhookEndpointStats.attempts} + ${attempts}`,
            lastDeliveredAt: sql`greatest(${webhookEndpointStats.lastDeliveredAt}, ${change.lastDeliveredAt ?? null})`,
            lastFailedAt: sql`greatest(${webhookEndpointStats.lastFailedAt}, ${change.lastFailedAt ?? null})`,
          },
        })
        .returning(),
    );
    const row = rows[0];
    // Unreachable: the upsert either inserts or updates, and both return the row.
    if (row === undefined) {
      throw new InternalError({ detail: { entity: "webhook_endpoint_stats", webhookId, day } });
    }
    return toRow(row);
  }

  /** A window of days for one endpoint, newest first, for the figures strip. */
  async forEndpoint(webhookId: string, since: string): Promise<WebhookDayStats[]> {
    const rows = await this.tx
      .select()
      .from(webhookEndpointStats)
      .where(
        and(
          this.tenantScope(),
          eq(webhookEndpointStats.webhookId, webhookId),
          gte(webhookEndpointStats.day, since),
        ),
      )
      .orderBy(desc(webhookEndpointStats.day));
    return rows.map(toRow);
  }

  /** The same window across every endpoint on the project, for the screen's own totals. */
  async forProject(since: string): Promise<WebhookDayStats[]> {
    const rows = await this.tx
      .select()
      .from(webhookEndpointStats)
      .where(and(this.tenantScope(), gte(webhookEndpointStats.day, since)))
      .orderBy(desc(webhookEndpointStats.day));
    return rows.map(toRow);
  }
}
