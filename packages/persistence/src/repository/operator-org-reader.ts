import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { invoices } from "../schema/billing.js";
import { orgs } from "../schema/organisation.js";

/** An invoice as the console lists it across organisations. */
export interface OperatorInvoiceRow {
  readonly orgId: string;
  readonly orgName: string;
  readonly number: string;
  readonly totalCents: number;
  readonly currency: string;
  readonly status: string;
  readonly dueAt: Date | null;
  readonly hostedUrl: string | null;
}

export interface OperatorOrgRow {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Organisations as the operator console finds them (ADR-0018).
 *
 * Cross-tenant by nature — an operator looks across every customer — so not an `OrgRepository`,
 * and reachable only from routes behind `StaffGuard`. It answers identifiers, names and dates;
 * anything about one organisation is then read through that organisation's own scope.
 */
export class OperatorOrgReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** One organisation by id, or null. */
  async byId(id: string): Promise<OperatorOrgRow | null> {
    const rows = await this.db
      .select({ id: orgs.id, name: orgs.name, createdAt: orgs.createdAt })
      .from(orgs)
      .where(eq(orgs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** By exact id, or by name containing the query, newest first. */
  async search(query: string, limit: number): Promise<readonly OperatorOrgRow[]> {
    const trimmed = query.trim();
    // LIKE's own wildcards in the query are matched literally: an operator typing "50%" is
    // looking for that, not for everything.
    const literal = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`);
    const byName = ilike(orgs.name, `%${literal}%`);
    const where = UUID.test(trimmed) ? or(eq(orgs.id, trimmed), byName) : byName;
    return await this.db
      .select({ id: orgs.id, name: orgs.name, createdAt: orgs.createdAt })
      .from(orgs)
      .where(trimmed.length === 0 ? sql`true` : where)
      .orderBy(desc(orgs.createdAt))
      .limit(limit);
  }

  /**
   * Invoices in one state across every organisation, oldest due first — the overdue list a person
   * works through, since nothing acts on an overdue invoice by itself (ADR-0019).
   */
  async invoicesByStatus(status: string, limit: number): Promise<readonly OperatorInvoiceRow[]> {
    return await this.db
      .select({
        orgId: invoices.orgId,
        orgName: orgs.name,
        number: invoices.number,
        totalCents: invoices.totalCents,
        currency: invoices.currency,
        status: invoices.status,
        dueAt: invoices.dueAt,
        hostedUrl: invoices.hostedUrl,
      })
      .from(invoices)
      .innerJoin(orgs, eq(orgs.id, invoices.orgId))
      .where(eq(invoices.status, status))
      .orderBy(asc(invoices.dueAt))
      .limit(limit);
  }
}
