import { ResourceConflictError } from "@idenzy/core/errors";
import type {
  BillingLineItem,
  InvoiceStatus,
  PaymentProvider,
} from "@idenzy/protocol/enums/billing";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { invoiceLines, invoices } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface InvoiceLineRow {
  /** Null on an organisation-level line: prepaid credit applied, prepaid debt carried over. */
  readonly projectId: string | null;
  readonly item: BillingLineItem;
  readonly quantity: number;
  readonly unitRateMillicents: number;
  readonly totalCents: number;
}

export interface InvoiceRow {
  readonly id: string;
  readonly number: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: InvoiceStatus;
  readonly totalCents: number;
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly providerInvoiceId: string | null;
  readonly pdfUri: string | null;
  readonly hostedUrl: string | null;
  readonly issuedAt: Date;
  readonly dueAt: Date | null;
  readonly paidAt: Date | null;
}

/** A line with its id, which is what makes creating it at the provider idempotent. */
export interface StoredInvoiceLine extends InvoiceLineRow {
  readonly id: string;
}

/** What the provider made of an invoice, written onto the draft that asked for it. */
export interface IssuedInvoiceRecord {
  readonly providerInvoiceId: string;
  readonly hostedUrl: string | null;
  readonly pdfUrl: string | null;
  readonly issuedAt: Date;
  readonly dueAt: Date | null;
}

export interface NewInvoice {
  readonly number: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly issuedAt: Date;
  readonly dueAt: Date | null;
  /** Set on an invoice that is settled the moment it is written, as one covered by credit. */
  readonly paidAt?: Date | null;
  readonly lines: readonly InvoiceLineRow[];
}

function toRow(row: typeof invoices.$inferSelect): InvoiceRow {
  return {
    id: row.id,
    number: row.number,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    // Safe: each column is written only from the matching protocol enum.
    status: row.status as InvoiceStatus,
    provider: row.provider as PaymentProvider,
    totalCents: row.totalCents,
    currency: row.currency,
    providerInvoiceId: row.providerInvoiceId,
    pdfUri: row.pdfUri,
    hostedUrl: row.hostedUrl,
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
  };
}

/** What is owed: an invoice that is neither settled nor cancelled. */
const OUTSTANDING: readonly InvoiceStatus[] = ["open", "past_due"];

/**
 * Invoices for the organisation's closed months (ADR-0011, PROJECT.md 5.1).
 *
 * An invoice covers the organisation and is made of lines per project, because the
 * organisation pays one bill and the question it gets asked internally is which
 * application spent it.
 *
 * The total is the sum of the lines and is never recomputed from quantities and rates.
 * Each line rounds once, and a second multiplication at the total would disagree with
 * the usage screen by a cent on exactly the months somebody checks.
 */
export class InvoiceRepository extends OrgRepository<typeof invoices> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, invoices);
  }

  /**
   * Issued invoices, newest first. Drafts are left out: a draft is the invoice run's working
   * state before the provider has issued anything, and a customer shown one would be shown a bill
   * that does not exist yet.
   */
  async list(limit = 50): Promise<InvoiceRow[]> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(this.orgScope(), ne(invoices.status, "draft")))
      .orderBy(desc(invoices.issuedAt))
      .limit(limit);
    return rows.map(toRow);
  }

  async outstanding(): Promise<InvoiceRow[]> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(this.orgScope(), inArray(invoices.status, [...OUTSTANDING])))
      .orderBy(invoices.issuedAt);
    return rows.map(toRow);
  }

  /**
   * One invoice's lines.
   *
   * Scoped on `invoice_lines.org_id` by name. `orgScope()` builds its predicate from this
   * repository's own table, `invoices`, and used here it emitted `"invoices"."org_id"` against a
   * query that does not join it — which Postgres refuses outright. Nothing wrote invoices until
   * the invoice run, so nothing had ever reached this.
   */
  async linesOf(invoiceId: string): Promise<StoredInvoiceLine[]> {
    const rows = await this.tx
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.orgId, this.context.orgId), eq(invoiceLines.invoiceId, invoiceId)))
      .orderBy(invoiceLines.projectId, invoiceLines.item);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      // Safe: written only from BillingLineItem.
      item: row.item as BillingLineItem,
      quantity: row.quantity,
      unitRateMillicents: row.unitRateMillicents,
      totalCents: row.totalCents,
    }));
  }

  /**
   * Raises an invoice and its lines together.
   *
   * One call because a header with no lines is a bill nobody can explain, and the caller
   * is inside a transaction either way. `invoices_org_period_key` is what makes a second
   * run of the monthly job safe: the closed month is already invoiced, and the conflict
   * says so rather than issuing a duplicate against the same period.
   */
  /** The invoice for one month, whatever its state, or null. There is at most one (unique). */
  async forPeriod(periodStart: string): Promise<InvoiceRow | null> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(this.orgScope(), eq(invoices.periodStart, periodStart)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /** Drafts the provider has not issued yet, oldest first: the invoice run's unfinished work. */
  async drafts(): Promise<InvoiceRow[]> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(this.orgScope(), eq(invoices.status, "draft")))
      .orderBy(invoices.createdAt);
    return rows.map(toRow);
  }

  /**
   * Writes the provider's answer onto a draft and opens it, once. `status = 'draft'` in the
   * predicate is what keeps a replay from rewriting an invoice the webhook has already moved on.
   */
  async recordIssued(id: string, issued: IssuedInvoiceRecord): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .update(invoices)
        .set({
          status: "open",
          providerInvoiceId: issued.providerInvoiceId,
          hostedUrl: issued.hostedUrl,
          pdfUri: issued.pdfUrl,
          issuedAt: issued.issuedAt,
          dueAt: issued.dueAt,
        })
        .where(and(this.orgScope(), eq(invoices.id, id), eq(invoices.status, "draft")))
        .returning({ id: invoices.id }),
    );
    return rows.length === 1;
  }

  async issue(invoice: NewInvoice, status: InvoiceStatus = "open"): Promise<InvoiceRow> {
    const totalCents = invoice.lines.reduce((total, line) => total + line.totalCents, 0);
    const rows = await this.guard(() =>
      this.tx
        .insert(invoices)
        .values({
          orgId: this.context.orgId,
          number: invoice.number,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          status,
          totalCents,
          currency: invoice.currency,
          provider: invoice.provider,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          paidAt: invoice.paidAt ?? null,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { number: invoice.number } });

    if (invoice.lines.length > 0) {
      await this.guard(() =>
        this.tx.insert(invoiceLines).values(
          invoice.lines.map((line) => ({
            orgId: this.context.orgId,
            invoiceId: row.id,
            ...line,
          })),
        ),
      );
    }
    return toRow(row);
  }

  async markPaid(id: string, paidAt: Date): Promise<boolean> {
    const rows = await this.tx
      .update(invoices)
      .set({ status: "paid", paidAt })
      .where(and(this.orgScope(), eq(invoices.id, id), inArray(invoices.status, [...OUTSTANDING])))
      .returning({ id: invoices.id });
    return rows.length === 1;
  }

  /** Everything unsettled, in cents. What the past-due banner is built from. */
  /** What is past due, in cents: the part of `outstandingCents` somebody should be told about. */
  async overdueCents(): Promise<number> {
    const rows = await this.tx
      .select({ total: sql<string>`coalesce(sum(${invoices.totalCents}), 0)` })
      .from(invoices)
      .where(and(this.orgScope(), eq(invoices.status, "past_due")));
    return Number(rows[0]?.total ?? 0);
  }

  async outstandingCents(): Promise<number> {
    const rows = await this.tx
      .select({ total: sql<string>`coalesce(sum(${invoices.totalCents}), 0)` })
      .from(invoices)
      .where(and(this.orgScope(), inArray(invoices.status, [...OUTSTANDING])));
    return Number(rows[0]?.total ?? 0);
  }
}
