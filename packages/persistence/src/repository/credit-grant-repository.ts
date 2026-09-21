import { ResourceConflictError } from "@idenzy/core/errors";
import { CreditKind } from "@idenzy/protocol/enums/billing";
import { and, asc, gt, isNull, or, sql } from "drizzle-orm";
import { creditGrants } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { ControlTx } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface CreditGrantRow {
  readonly id: string;
  readonly kind: CreditKind;
  readonly amountCents: number;
  readonly remainingCents: number;
  readonly currency: string;
  readonly topUpId: string | null;
  readonly note: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
}

export interface NewCreditGrant {
  readonly kind: CreditKind;
  readonly amountCents: number;
  readonly currency: string;
  readonly topUpId: string | null;
  readonly note: string;
  readonly expiresAt: Date | null;
}

function toRow(row: typeof creditGrants.$inferSelect): CreditGrantRow {
  return {
    id: row.id,
    // Safe: the column is written only from CreditKind.
    kind: row.kind as CreditKind,
    amountCents: row.amountCents,
    remainingCents: row.remainingCents,
    currency: row.currency,
    topUpId: row.topUpId,
    note: row.note,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * The organisation's wallet: what credit it holds, and what has been drawn from it
 * (ADR-0011, PROJECT.md 5.1).
 *
 * Grants rather than one balance column, so "what do I hold" and "how much of it
 * disappears next Tuesday" are answerable from the same rows. The balance is a sum over
 * what has not expired.
 */
export class CreditGrantRepository extends OrgRepository<typeof creditGrants> {
  constructor(tx: ControlTx, context: OrgContext) {
    super(tx, context, creditGrants);
  }

  /** Unexpired grants with something left, in the order they are drawn down. */
  async spendable(now: Date): Promise<CreditGrantRow[]> {
    const rows = await this.tx
      .select()
      .from(creditGrants)
      .where(
        and(
          this.orgScope(),
          gt(creditGrants.remainingCents, 0),
          or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now)),
        ),
      )
      // Promotional first, and soonest to expire first inside each kind: spend what
      // would otherwise be lost before spending what keeps. Drawn down the other way
      // round, an account holding both watches a promotional grant expire unused while
      // its purchased credit pays the bill, and is right to call that a wrong charge.
      .orderBy(
        sql`case when ${creditGrants.kind} = ${CreditKind.Promotional} then 0 else 1 end`,
        sql`${creditGrants.expiresAt} asc nulls last`,
        asc(creditGrants.grantedAt),
      );
    return rows.map(toRow);
  }

  /** What is spendable right now, in cents. The figure every balance tile shows. */
  async balanceCents(now: Date): Promise<number> {
    const rows = await this.tx
      .select({ total: sql<string>`coalesce(sum(${creditGrants.remainingCents}), 0)` })
      .from(creditGrants)
      .where(
        and(this.orgScope(), or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now))),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async grant(grant: NewCreditGrant): Promise<CreditGrantRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(creditGrants)
        .values({
          orgId: this.context.orgId,
          ...grant,
          remainingCents: grant.amountCents,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { topUpId: grant.topUpId } });
    return toRow(row);
  }

  /**
   * Takes cents off one grant, and answers how many it actually took.
   *
   * The subtraction happens in the statement, not in a read-modify-write: two meters
   * draining the same wallet concurrently would both read the same remainder, and the
   * second write would put back what the first had spent. `for update` serialises them,
   * and `greatest(..., 0)` keeps the check constraint satisfied when a grant is asked for
   * more than it holds.
   *
   * The figure returned is the difference the database saw rather than the figure asked
   * for, which is what lets a caller walk the grants in draw order and know how much of
   * the charge is still owed after each one.
   */
  async draw(id: string, cents: number): Promise<number> {
    if (cents <= 0) return 0;
    // The CTE reads the pre-update remainder, so RETURNING can subtract one from the
    // other. Drizzle's query builder cannot express a RETURNING over two relations.
    const result = await this.tx.execute<{ drawn: string }>(sql`
      with target as (
        select id, remaining_cents
        from credit_grants
        where id = ${id} and org_id = ${this.context.orgId}
        for update
      )
      update credit_grants g
      set remaining_cents = greatest(g.remaining_cents - ${cents}, 0)
      from target t
      where g.id = t.id
      returning t.remaining_cents - g.remaining_cents as drawn
    `);
    return Number(result.rows[0]?.drawn ?? 0);
  }
}
