import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq, isNull, or } from "drizzle-orm";
import { emailChangeRequests } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** Which address a confirmation token was mailed to. */
export type ChangeSide = "old" | "new";

export interface NewEmailChange {
  readonly userId: string;
  readonly newEmail: string;
  readonly oldTokenHash: string;
  readonly newTokenHash: string;
  readonly expiresAt: Date;
}

export interface EmailChangeRow {
  readonly id: string;
  readonly userId: string;
  readonly newEmail: string;
  readonly oldConfirmedAt: Date | null;
  readonly newConfirmedAt: Date | null;
  readonly appliedAt: Date | null;
  readonly expiresAt: Date;
}

export interface MatchedEmailChange extends EmailChangeRow {
  /** Which token matched, so the caller confirms the side that was actually presented. */
  readonly side: ChangeSide;
}

/**
 * A pending email change, which needs two confirmations (PROJECT.md 4.5).
 *
 * Confirming is idempotent per side and neither side alone moves the address. The old
 * address is in the loop because an attacker who has taken an account wants the change
 * to be invisible to the person losing it, and a notice to an address they no longer
 * control is the only warning that person gets.
 */
export class EmailChangeRepository extends BaseRepository<typeof emailChangeRequests> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, emailChangeRequests);
  }

  async open(input: NewEmailChange): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(emailChangeRequests)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          newEmail: input.newEmail,
          oldTokenHash: input.oldTokenHash,
          newTokenHash: input.newTokenHash,
          expiresAt: input.expiresAt,
        })
        .returning({ id: emailChangeRequests.id }),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ResourceNotFoundError({ detail: { entity: "email_change_request" } });
    }
    return row.id;
  }

  /** One lookup for both sides: the caller does not know which half it was handed. */
  async findByToken(tokenHash: string): Promise<MatchedEmailChange | null> {
    const rows = await this.tx
      .select()
      .from(emailChangeRequests)
      .where(
        and(
          this.tenantScope(),
          or(
            eq(emailChangeRequests.oldTokenHash, tokenHash),
            eq(emailChangeRequests.newTokenHash, tokenHash),
          ),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      newEmail: row.newEmail,
      oldConfirmedAt: row.oldConfirmedAt,
      newConfirmedAt: row.newConfirmedAt,
      appliedAt: row.appliedAt,
      expiresAt: row.expiresAt,
      side: row.oldTokenHash === tokenHash ? "old" : "new",
    };
  }

  async confirm(id: string, side: ChangeSide, at: Date): Promise<EmailChangeRow | null> {
    const rows = await this.tx
      .update(emailChangeRequests)
      .set(side === "old" ? { oldConfirmedAt: at } : { newConfirmedAt: at })
      .where(and(this.tenantScope(), eq(emailChangeRequests.id, id)))
      .returning();
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      newEmail: row.newEmail,
      oldConfirmedAt: row.oldConfirmedAt,
      newConfirmedAt: row.newConfirmedAt,
      appliedAt: row.appliedAt,
      expiresAt: row.expiresAt,
    };
  }

  /** Marks the change done, and reports whether this call is the one that applied it. */
  async markApplied(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(emailChangeRequests)
      .set({ appliedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(emailChangeRequests.id, id),
          isNull(emailChangeRequests.appliedAt),
        ),
      )
      .returning({ id: emailChangeRequests.id });
    return rows.length === 1;
  }

  /**
   * Cancels every other pending change for the user, so requesting a new address
   * abandons the previous request rather than leaving two live sets of tokens.
   *
   * Cancelling expires the request rather than marking it applied. `appliedAt` means the
   * address moved, and a cancelled request is exactly a request that ran out of time, so
   * every validity check already handles it and none has to learn a third state.
   */
  async cancelOutstanding(userId: string, at: Date): Promise<number> {
    const rows = await this.tx
      .update(emailChangeRequests)
      .set({ expiresAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(emailChangeRequests.userId, userId),
          isNull(emailChangeRequests.appliedAt),
        ),
      )
      .returning({ id: emailChangeRequests.id });
    return rows.length;
  }
}
