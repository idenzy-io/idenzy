import { and, isNull, sql } from "drizzle-orm";
import { emailSendingHolds } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** Which rate tripped. Both are recorded on the row whichever one did. */
export const HoldReason = {
  BounceRate: "bounce_rate",
  ComplaintRate: "complaint_rate",
} as const;
export type HoldReason = (typeof HoldReason)[keyof typeof HoldReason];

export interface NewSendingHold {
  readonly reason: HoldReason;
  readonly bounceRatePpm: number;
  readonly complaintRatePpm: number;
  readonly observedSends: number;
}

export interface SendingHoldRow {
  readonly id: string;
  readonly reason: string;
  readonly bounceRatePpm: number;
  readonly complaintRatePpm: number;
  readonly observedSends: number;
  readonly openedAt: Date;
}

/**
 * Whether a project's email is stopped, and the evidence it was stopped on (risks.md 2).
 *
 * A stored decision rather than a rate recomputed per send. That keeps the send path to one
 * indexed read, and it makes the refusal a record somebody can be shown — with the figures
 * that caused it, at the moment they caused it, rather than a number that has moved since.
 *
 * `open` is idempotent through the partial unique index, so a breaker pass that runs twice,
 * or two replicas running at once, leave one hold rather than a second one a release would
 * miss.
 */
export class EmailSendingHoldRepository extends BaseRepository<typeof emailSendingHolds> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, emailSendingHolds);
  }

  /** The open hold, or null. What the send path asks. */
  async current(): Promise<SendingHoldRow | null> {
    const rows = await this.tx
      .select({
        id: emailSendingHolds.id,
        reason: emailSendingHolds.reason,
        bounceRatePpm: emailSendingHolds.bounceRatePpm,
        complaintRatePpm: emailSendingHolds.complaintRatePpm,
        observedSends: emailSendingHolds.observedSends,
        openedAt: emailSendingHolds.openedAt,
      })
      .from(emailSendingHolds)
      .where(and(this.tenantScope(), isNull(emailSendingHolds.releasedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Opens one, or answers false because this project already has an open hold. */
  async open(hold: NewSendingHold): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .insert(emailSendingHolds)
        .values({ projectId: this.context.projectId, ...hold })
        .onConflictDoNothing()
        .returning({ id: emailSendingHolds.id }),
    );
    return rows.length === 1;
  }

  /**
   * Lifts the open hold, keeping the row.
   *
   * `releasedBy` is null where the breaker lifted it because the window went clean, and a
   * staff identifier where a person did. Which of the two it was is the first thing anybody
   * asks afterwards, so it is a column rather than something inferred from the reason text.
   */
  async release(releasedBy: string | null, reason: string): Promise<boolean> {
    const rows = await this.tx
      .update(emailSendingHolds)
      .set({ releasedAt: sql`now()`, releasedBy, releasedReason: reason })
      .where(and(this.tenantScope(), isNull(emailSendingHolds.releasedAt)))
      .returning({ id: emailSendingHolds.id });
    return rows.length === 1;
  }
}
