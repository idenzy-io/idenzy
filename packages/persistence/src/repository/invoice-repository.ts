import { ResourceConflictError } from "@idenzy/core/errors";
import type {
  BillingLineItem,
  InvoiceStatus,
  PaymentProvider,
} from "@idenzy/protocol/enums/billing";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { invoiceLines, invoices } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface InvoiceLineRow {
  readonly projectId: string;
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
  readonly issuedAt: Date;
  readonly dueAt: Date | null;
  readonly paidAt: Date | null;
}

export interface NewInvoice {
  readonly number: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly issuedAt: Date;
  readonly dueAt: Date | null;
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

  async list(limit = 50): Promise<InvoiceRow[]> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(this.orgScope())
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

  async linesOf(invoiceId: string): Promise<InvoiceLineRow[]> {
    const rows = await this.tx
      .select()
      .from(invoiceLines)
      .where(and(this.orgScope(), eq(invoiceLines.invoiceId, invoiceId)))
      .orderBy(invoiceLines.projectId, invoiceLines.item);
    return rows.map((row) => ({
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
  async issue(invoice: NewInvoice): Promise<InvoiceRow> {
    const totalCents = invoice.lines.reduce((total, line) => total + line.totalCents, 0);
    const rows = await this.guard(() =>
      this.tx
        .insert(invoices)
        .values({
          orgId: this.context.orgId,
          number: invoice.number,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          status: "open",
          totalCents,
          currency: invoice.currency,
          provider: invoice.provider,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
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
  async outstandingCents(): Promise<number> {
    const rows = await this.tx
      .select({ total: sql<string>`coalesce(sum(${invoices.totalCents}), 0)` })
      .from(invoices)
      .where(and(this.orgScope(), inArray(invoices.status, [...OUTSTANDING])));
    return Number(rows[0]?.total ?? 0);
  }
}
