import { eq } from "drizzle-orm";
import { projectSpendState } from "../schema/usage.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface SpendState {
  readonly spendable: boolean;
  readonly reason: string;
  readonly computedAt: Date;
  readonly staleAfter: Date;
}

/**
 * The cell's own copy of whether its organisation may still spend (ADR-0016).
 *
 * A tenant repository like any other, which is the point: reading it is one indexed lookup inside
 * the transaction the request already has, against a table in the project's own cell. What it
 * replaced was three reads across the plane boundary on the send path.
 */
export class ProjectSpendStateRepository extends BaseRepository<typeof projectSpendState> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, projectSpendState);
  }

  /** The last decision the drawdown published, or null if it has never published one. */
  async current(): Promise<SpendState | null> {
    const rows = await this.tx
      .select()
      .from(projectSpendState)
      .where(eq(projectSpendState.projectId, this.context.projectId))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          spendable: row.spendable,
          reason: row.reason,
          computedAt: row.computedAt,
          staleAfter: row.staleAfter,
        };
  }

  /**
   * Publishes a decision, replacing whatever was there.
   *
   * An upsert rather than an insert-then-update: the drawdown reprices a month every pass, so
   * this is written far more often than it is created, and a conditional write would be two
   * statements where one does.
   */
  async publish(state: SpendState): Promise<void> {
    await this.tx
      .insert(projectSpendState)
      .values({
        projectId: this.context.projectId,
        spendable: state.spendable,
        reason: state.reason,
        computedAt: state.computedAt,
        staleAfter: state.staleAfter,
      })
      .onConflictDoUpdate({
        target: projectSpendState.projectId,
        set: {
          spendable: state.spendable,
          reason: state.reason,
          computedAt: state.computedAt,
          staleAfter: state.staleAfter,
        },
      });
  }
}
