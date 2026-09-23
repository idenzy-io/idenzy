import { inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { projects } from "../schema/projects.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An automatic charge that has been open longer than it should be. */
export interface OpenAutomaticCharge {
  readonly orgId: string;
  readonly topUpId: string;
  readonly providerIntentId: string | null;
  readonly createdAt: Date;
}

/**
 * What the billing worker has to find across every organisation (ADR-0017).
 *
 * Not an `OrgRepository`, for the reason `OrgUsageActivityReader` is not one: the worker serves
 * every organisation and cannot be scoped to one before it knows which. Everything here answers
 * identifiers and timestamps and nothing else; what the worker does with each id is ordinary
 * and scoped.
 */
export class BillingWorkReader {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Each project's organisation, for the projects a usage signal named.
   *
   * The ids came out of Valkey, so anything that is not a uuid is dropped before it reaches a
   * uuid column: one malformed member would otherwise fail the whole batch, every tick, for
   * ever.
   */
  async orgsOf(projectIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const valid = projectIds.filter((id) => UUID.test(id));
    if (valid.length === 0) return new Map();
    const rows = await this.db
      .select({ id: projects.id, orgId: projects.orgId })
      .from(projects)
      .where(inArray(projects.id, valid));
    return new Map(rows.map((row) => [row.id, row.orgId]));
  }

  /**
   * One page of organisations whose rule could fire — on, and not suspended — after `after`.
   *
   * The periodic pass reads this and not the cache, so a signal lost to a Valkey restart and a
   * cached "off" that went stale are both caught here within one pass.
   */
  async armedRules(limit: number, after: string | null = null): Promise<readonly string[]> {
    const rows = await this.db.execute<{ org_id: string }>(
      sql`select org_id from billing_settings
          where auto_top_up_enabled and auto_top_up_suspended_at is null
            and (${after}::uuid is null or org_id > ${after}::uuid)
          order by org_id limit ${limit}`,
    );
    return rows.rows.map((row) => row.org_id);
  }

  /** Automatic charges still open since before `before`, oldest first. */
  async openAutomaticCharges(before: Date, limit: number): Promise<readonly OpenAutomaticCharge[]> {
    const rows = await this.db.execute<{
      org_id: string;
      id: string;
      provider_intent_id: string | null;
      created_at: Date | string;
    }>(
      sql`select org_id, id, provider_intent_id, created_at from top_ups
          where trigger = 'automatic' and settled_at is null and created_at < ${before.toISOString()}::timestamptz
          order by created_at limit ${limit}`,
    );
    return rows.rows.map((row) => ({
      orgId: row.org_id,
      topUpId: row.id,
      providerIntentId: row.provider_intent_id,
      createdAt: new Date(row.created_at),
    }));
  }
}
